const pool = require("../db");
const { logAudit, assertDifferentUser } = require("./auditService");

const EVENT_TYPES = new Set([
  "probation_confirmation",
  "promotion",
  "salary_change",
  "branch_transfer",
  "termination",
]);
const EMPLOYMENT_TYPES = new Set(["permanent", "contract", "probation", "intern"]);

function dateKey(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRequestedValues(eventType, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Provide the requested lifecycle changes");
  }

  const values = {};
  const textFields = ["job_title", "department"];
  const moneyFields = ["basic_salary", "house_allowance", "transport_allowance"];

  if (eventType === "probation_confirmation") {
    if (input.employment_type && input.employment_type !== "permanent") {
      throw new Error("Probation confirmation must change employment type to permanent");
    }
    values.employment_type = "permanent";
    for (const field of moneyFields) {
      if (input[field] !== undefined) values[field] = normalizeMoney(input[field], field);
    }
    return values;
  }

  if (eventType === "promotion" || eventType === "salary_change") {
    const allowedFields = eventType === "promotion" ? [...textFields, ...moneyFields] : moneyFields;
    for (const field of allowedFields) {
      if (input[field] === undefined) continue;
      values[field] = textFields.includes(field)
        ? normalizeText(input[field], field)
        : normalizeMoney(input[field], field);
    }
    if (!Object.keys(values).length) throw new Error("Provide at least one approved change");
    return values;
  }

  if (eventType === "branch_transfer") {
    values.branch_id = String(input.branch_id || "").trim();
    if (!values.branch_id) throw new Error("Choose the destination branch");
    return values;
  }

  const reason = normalizeText(input.reason, "termination reason", 1000);
  if (reason.length < 10) throw new Error("Enter a termination reason of at least 10 characters");
  return { reason };
}

function normalizeText(value, label, maxLength = 180) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw new Error(`Enter a valid ${label}`);
  return text;
}

function normalizeMoney(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) {
    throw new Error(`Enter a valid non-negative ${label}`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

async function requestLifecycleEvent({ companyId, userId, employeeId, eventType, effectiveDate, requestedValues }) {
  if (!EVENT_TYPES.has(eventType)) throw new Error("Unsupported employee lifecycle event");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ""))
      || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) {
    throw new Error("Provide a valid effective date");
  }
  const values = normalizeRequestedValues(eventType, requestedValues);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employeeResult = await client.query(
      `SELECT id,employee_code,branch_id,user_id,employment_type,hire_date,department,job_title,
              basic_salary,is_active
       FROM erp_employees
       WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE
       FOR UPDATE`,
      [employeeId, companyId],
    );
    const employee = employeeResult.rows[0];
    if (!employee || !employee.is_active) throw new Error("Choose an active employee in this company");
    if (String(effectiveDate) < dateKey(employee.hire_date)) {
      throw new Error("The effective date cannot be before the employee hire date");
    }

    if (eventType === "branch_transfer") {
      const branch = await client.query(
        "SELECT 1 FROM erp_branches WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        [values.branch_id, companyId],
      );
      if (!branch.rowCount) throw new Error("Destination branch does not belong to this company");
    }

    const contractResult = await client.query(
      `SELECT contract_type,basic_salary,house_allowance,transport_allowance,start_date
       FROM erp_employee_contracts
       WHERE company_id=$1 AND employee_id=$2 AND status='active' AND is_deleted=FALSE
       ORDER BY start_date DESC LIMIT 1`,
      [companyId, employeeId],
    );
    const activeContract = contractResult.rows[0] || null;
    if (["probation_confirmation", "promotion", "salary_change"].includes(eventType) && !activeContract) {
      throw new Error("An active employment contract is required for this change");
    }
    if (["probation_confirmation", "promotion", "salary_change"].includes(eventType)
      && activeContract && effectiveDate <= dateKey(activeContract.start_date)) {
      throw new Error("The effective date must be after the active contract start date");
    }

    const previousValues = {
      branch_id: employee.branch_id,
      employment_type: employee.employment_type,
      department: employee.department,
      job_title: employee.job_title,
      basic_salary: Number(activeContract?.basic_salary ?? employee.basic_salary),
      house_allowance: Number(activeContract?.house_allowance ?? 0),
      transport_allowance: Number(activeContract?.transport_allowance ?? 0),
      contract_type: activeContract?.contract_type ?? employee.employment_type,
    };
    const inserted = await client.query(
      `INSERT INTO erp_employee_lifecycle_events
         (company_id,employee_id,event_type,effective_date,requested_values,previous_values,requested_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
       RETURNING id,company_id,employee_id,event_type,effective_date,status,requested_values,
                 previous_values,requested_by,created_at`,
      [companyId, employeeId, eventType, effectiveDate, JSON.stringify(values), JSON.stringify(previousValues), userId],
    );
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_employee_lifecycle_events",
      entityId: inserted.rows[0].id,
      action: "employee_lifecycle_requested",
      newValues: { employee_code: employee.employee_code, event_type: eventType, effective_date: effectiveDate, requested_values: values },
    });
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function decideLifecycleEvent({ companyId, userId, eventId, decision, decisionNote }) {
  if (!new Set(["approved", "rejected"]).has(decision)) throw new Error("Choose approve or reject");
  const note = normalizeText(decisionNote, "decision note", 1000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,employee_id,event_type,status,requested_by,effective_date,requested_values
       FROM erp_employee_lifecycle_events
       WHERE id=$1 AND company_id=$2
       FOR UPDATE`,
      [eventId, companyId],
    );
    const event = result.rows[0];
    if (!event || event.status !== "pending") throw new Error("Only a pending lifecycle request can be decided");
    assertDifferentUser(event.requested_by, userId);
    const updated = await client.query(
      `UPDATE erp_employee_lifecycle_events
       SET status=$3,decision_note=$4,reviewed_by=$5,reviewed_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND company_id=$2
       RETURNING id,employee_id,event_type,effective_date,status,requested_values,previous_values,
                 requested_by,reviewed_by,reviewed_at,decision_note`,
      [eventId, companyId, decision, note, userId],
    );
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_employee_lifecycle_events",
      entityId: eventId,
      action: `employee_lifecycle_${decision}`,
      oldValues: { status: "pending" },
      newValues: { status: decision, decision_note: note },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function applyLifecycleEvent({ companyId, userId, eventId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT event.*,employee.employee_code,employee.user_id,employee.hire_date,
              employee.is_active,employee.branch_id,employee.employment_type,
              employee.is_deleted AS employee_is_deleted,employee.department,employee.job_title,employee.basic_salary
       FROM erp_employee_lifecycle_events event
       JOIN erp_employees employee ON employee.id=event.employee_id AND employee.company_id=event.company_id
       WHERE event.id=$1 AND event.company_id=$2
       FOR UPDATE OF event,employee`,
      [eventId, companyId],
    );
    const event = result.rows[0];
    if (!event || event.status !== "approved") throw new Error("Only an approved lifecycle request can be applied");
    if (dateKey(event.effective_date) > dateKey(new Date())) {
      throw new Error("This lifecycle change is not effective yet");
    }
    if (!event.is_active || event.employee_is_deleted) throw new Error("The employee is no longer active");

    const values = event.requested_values || {};
    const effectiveDate = dateKey(event.effective_date);
    if (event.event_type === "branch_transfer") {
      const branch = await client.query(
        "SELECT 1 FROM erp_branches WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        [values.branch_id, companyId],
      );
      if (!branch.rowCount) throw new Error("Destination branch is no longer available");
      await client.query(
        "UPDATE erp_employees SET branch_id=$3,updated_by=$4,updated_at=NOW() WHERE id=$1 AND company_id=$2",
        [event.employee_id, companyId, values.branch_id, userId],
      );
    } else if (["probation_confirmation", "promotion", "salary_change"].includes(event.event_type)) {
      const contractResult = await client.query(
        `SELECT id,contract_type,basic_salary,house_allowance,transport_allowance,start_date
         FROM erp_employee_contracts
         WHERE company_id=$1 AND employee_id=$2 AND status='active' AND is_deleted=FALSE
         ORDER BY start_date DESC LIMIT 1 FOR UPDATE`,
        [companyId, event.employee_id],
      );
      const contract = contractResult.rows[0];
      if (!contract || effectiveDate <= dateKey(contract.start_date)) {
        throw new Error("The active contract changed; review and submit the lifecycle request again");
      }
      const contractType = event.event_type === "probation_confirmation" ? "permanent" : contract.contract_type;
      const basicSalary = Number(values.basic_salary ?? contract.basic_salary);
      const houseAllowance = Number(values.house_allowance ?? contract.house_allowance);
      const transportAllowance = Number(values.transport_allowance ?? contract.transport_allowance);
      await client.query(
        `UPDATE erp_employee_contracts
         SET status='ended',end_date=($3::date - INTERVAL '1 day')::date,updated_by=$4,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [contract.id, companyId, effectiveDate, userId],
      );
      await client.query(
        `INSERT INTO erp_employee_contracts
           (company_id,employee_id,contract_type,start_date,basic_salary,house_allowance,transport_allowance,status,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)`,
        [companyId, event.employee_id, contractType, effectiveDate, basicSalary, houseAllowance, transportAllowance, userId],
      );
      await client.query(
        `UPDATE erp_employees SET employment_type=$3,basic_salary=$4,
             department=COALESCE($5,department),job_title=COALESCE($6,job_title),updated_by=$7,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [event.employee_id, companyId, contractType, basicSalary, values.department || null, values.job_title || null, userId],
      );
    } else if (event.event_type === "termination") {
      const payroll = await client.query(
        `SELECT 1 FROM erp_payslips slip
         JOIN erp_payroll_runs run ON run.id=slip.payroll_run_id AND run.company_id=slip.company_id
         WHERE slip.company_id=$1 AND slip.employee_id=$2 AND run.status='posted'
           AND run.payroll_month >= date_trunc('month',$3::date)::date
         LIMIT 1`,
        [companyId, event.employee_id, effectiveDate],
      );
      if (payroll.rowCount) throw new Error("A posted payroll run exists on or after the termination date; reconcile payroll before applying termination");
      await client.query(
        `UPDATE erp_employee_contracts
         SET status='ended',end_date=GREATEST(start_date,$3::date),updated_by=$4,updated_at=NOW()
         WHERE company_id=$1 AND employee_id=$2 AND status='active' AND is_deleted=FALSE`,
        [companyId, event.employee_id, effectiveDate, userId],
      );
      await client.query(
        `UPDATE erp_employees SET is_active=FALSE,termination_date=$3,updated_by=$4,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [event.employee_id, companyId, effectiveDate, userId],
      );
      if (event.user_id) {
        await client.query(
          `UPDATE erp_users SET status='inactive',updated_by=$3,updated_at=NOW()
           WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE`,
          [event.user_id, companyId, userId],
        );
        await client.query(
          `UPDATE erp_refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()),updated_at=NOW(),updated_by=$3
           WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL`,
          [companyId, event.user_id, userId],
        );
      }
    }

    const updated = await client.query(
      `UPDATE erp_employee_lifecycle_events SET status='applied',applied_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND company_id=$2
       RETURNING id,employee_id,event_type,effective_date,status,requested_values,previous_values,
                 requested_by,reviewed_by,reviewed_at,applied_at,decision_note`,
      [eventId, companyId],
    );
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_employee_lifecycle_events",
      entityId: eventId,
      action: "employee_lifecycle_applied",
      newValues: { employee_code: event.employee_code, event_type: event.event_type, effective_date: effectiveDate },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listLifecycleEvents({ companyId, employeeId }) {
  const result = await pool.query(
    `SELECT id,company_id,employee_id,event_type,effective_date,status,requested_values,
            previous_values,decision_note,requested_by,reviewed_by,reviewed_at,applied_at,created_at
     FROM erp_employee_lifecycle_events
     WHERE company_id=$1 AND employee_id=$2
     ORDER BY effective_date DESC,created_at DESC`,
    [companyId, employeeId],
  );
  return result.rows;
}

module.exports = {
  requestLifecycleEvent,
  decideLifecycleEvent,
  applyLifecycleEvent,
  listLifecycleEvents,
};