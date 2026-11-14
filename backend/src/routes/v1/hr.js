const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const { logAudit, assertDifferentUser } = require("../../services/auditService");
const { nextDocumentNo } = require("../../services/documentNumberingService");
const { normalizeEmployeePii, decryptEmployeeValue } = require("../../lib/employeePii");
const employeeLifecycle = require("../../services/employeeLifecycleService");
const { SCHEDULED_EMPLOYEE_FIELDS } = require("../../services/hrComplianceService");

const router = express.Router();
router.use(authenticateErp);

function monthDifference(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()));
}

async function getLeaveBalancesForEmployee(companyId, employeeId) {
  const employee = await pool.query(
    `SELECT id, hire_date FROM erp_employees
     WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE`,
    [employeeId, companyId],
  );
  if (!employee.rowCount) return [];
  const balanceRows = await pool.query(
    `SELECT b.id, b.employee_id, b.leave_type_id, b.balance_days, b.carryover_days, b.accrued_through,
            lt.code, lt.name, lt.days_per_year, lt.accrual_method, lt.encashment_allowed
     FROM erp_leave_balances b
     JOIN erp_leave_types lt ON lt.id = b.leave_type_id AND lt.company_id = b.company_id
     WHERE b.company_id=$1 AND b.employee_id=$2 AND b.is_deleted=FALSE AND lt.is_active=TRUE AND lt.is_deleted=FALSE
     ORDER BY lt.name`,
    [companyId, employeeId],
  );

  const today = new Date();
  const hireDate = employee.rows[0].hire_date ? new Date(`${employee.rows[0].hire_date}T00:00:00Z`) : null;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return balanceRows.rows.map((row) => {
    const baseBalance = Number(row.balance_days || 0) + Number(row.carryover_days || 0);
    const annualDays = Number(row.days_per_year || 0);
    const accrualMethod = String(row.accrual_method || "annual");
    let projectedAccrual = 0;

    if (accrualMethod !== "none" && annualDays > 0 && hireDate) {
      const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
      const accruedThrough = row.accrued_through ? new Date(`${row.accrued_through}T00:00:00Z`) : hireDate;
      const monthsSinceAccrual = Math.max(0, monthDifference(
        `${accruedThrough.getFullYear()}-${String(accruedThrough.getMonth() + 1).padStart(2, "0")}-01`,
        monthStart,
      ));
      if (accrualMethod === "monthly") {
        projectedAccrual = monthsSinceAccrual * (annualDays / 12);
      } else if (accrualMethod === "annual") {
        const currentYearStart = `${today.getFullYear()}-01-01`;
        if (!row.accrued_through || new Date(`${row.accrued_through}T00:00:00Z`) < new Date(`${currentYearStart}T00:00:00Z`)) {
          projectedAccrual = annualDays;
        }
      }
    }

    const availability = baseBalance + projectedAccrual;
    return {
      id: row.id,
      employee_id: row.employee_id,
      leave_type_id: row.leave_type_id,
      leave_type_code: row.code,
      leave_type_name: row.name,
      days_per_year: Number(row.days_per_year || 0),
      accrual_method: accrualMethod,
      encashment_allowed: Boolean(row.encashment_allowed),
      current_balance: Number(row.balance_days || 0),
      carryover_days: Number(row.carryover_days || 0),
      accrued_through: row.accrued_through ? String(row.accrued_through).slice(0, 10) : null,
      available_days: Number(availability.toFixed(2)),
      projected_accrual_days: Number(projectedAccrual.toFixed(2)),
      as_of_date: todayIso,
    };
  });
}

router.get("/employees", requirePermission("hr.view"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const result = await pool.query(
        `SELECT e.id,e.company_id,e.branch_id,e.user_id,e.manager_id,e.employee_code,
          e.first_name,e.last_name,e.email,e.phone,e.department,e.job_title,
          e.employment_type,e.hire_date,e.basic_salary,e.is_active,e.created_at,
          b.name AS branch_name
     FROM erp_employees e
     LEFT JOIN erp_branches b ON b.id = e.branch_id
     WHERE e.company_id = $1 AND e.is_deleted = FALSE
       AND ($2 = '' OR e.first_name ILIKE '%' || $2 || '%' OR e.last_name ILIKE '%' || $2 || '%' OR e.employee_code ILIKE '%' || $2 || '%')
     ORDER BY e.last_name, e.first_name`,
    [req.user.company_id, q],
  );
  return res.json(result.rows);
});

router.get("/branches", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT id,code,name FROM erp_branches
     WHERE company_id=$1 AND is_deleted=FALSE
     ORDER BY name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/legal-rules", requirePermission("hr.view"), async (req, res) => {
  const ruleGroup = typeof req.query.rule_group === "string" ? req.query.rule_group.trim() : null;
  const params = [req.user.company_id];
  let clause = "WHERE company_id = $1";
  if (ruleGroup) {
    params.push(ruleGroup);
    clause += ` AND rule_group = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT * FROM erp_hr_legal_rules ${clause} AND status = 'active' ORDER BY rule_group, rule_key, effective_from DESC`,
    params,
  );
  return res.json(result.rows);
});

router.post("/legal-rules", requirePermission("hr.approve"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.rule_group || !payload.rule_key || !payload.source_name) {
    return res.status(400).json({ error: "rule_group, rule_key and source_name are required" });
  }
  const result = await pool.query(
    `INSERT INTO erp_hr_legal_rules (
       company_id, rule_group, rule_key, rule_value, description, source_name, source_url,
       source_date, effective_from, status, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_DATE), COALESCE($10, 'active'), $11)
     ON CONFLICT (company_id, rule_group, rule_key, effective_from) DO UPDATE SET
       rule_value = EXCLUDED.rule_value,
       description = EXCLUDED.description,
       source_name = EXCLUDED.source_name,
       source_url = EXCLUDED.source_url,
       source_date = EXCLUDED.source_date,
       status = EXCLUDED.status,
       updated_at = NOW(),
       created_by = COALESCE(erp_hr_legal_rules.created_by, EXCLUDED.created_by)
     RETURNING *`,
    [
      req.user.company_id,
      payload.rule_group,
      payload.rule_key,
      Number(payload.rule_value ?? 0),
      payload.description || null,
      payload.source_name,
      payload.source_url || null,
      payload.source_date || null,
      payload.effective_from || null,
      payload.status || "active",
      req.user.id,
    ],
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/employees/hire", requirePermission("hr.create"), async (req, res) => {
  const body = req.body || {};
  const employeeCode = typeof body.employee_code === "string" ? body.employee_code.trim() : "";
  const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";
  const hireDate = typeof body.hire_date === "string" ? body.hire_date : "";
  const contractType = body.contract_type || body.employment_type || "probation";
  const allowedTypes = ["permanent", "contract", "probation", "intern"];
  const basicSalary = Number(body.basic_salary ?? 0);
  if (!employeeCode || !firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)
      || Number.isNaN(Date.parse(`${hireDate}T00:00:00Z`))
      || !allowedTypes.includes(contractType) || !Number.isFinite(basicSalary) || basicSalary < 0) {
    return res.status(400).json({ error: "Provide employee code, name, valid hire date, contract type, and non-negative salary" });
  }

  let pii;
  try {
    pii = normalizeEmployeePii(body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (body.branch_id) {
      const branch = await client.query(
        "SELECT 1 FROM erp_branches WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        [body.branch_id, req.user.company_id],
      );
      if (!branch.rowCount) throw new Error("Branch does not belong to this company");
    }
    const employee = await client.query(
      `INSERT INTO erp_employees (
         company_id,branch_id,employee_code,first_name,last_name,email,phone,
         department,job_title,employment_type,hire_date,basic_salary,
         id_number,tax_pin,bank_account_no,national_id_encrypted,kra_pin_encrypted,
         nssf_number_encrypted,sha_number_encrypted,bank_account_no_encrypted,
         pii_key_version,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,NULL,$13,$14,$15,$16,$17,1,$18)
       RETURNING id,company_id,branch_id,employee_code,first_name,last_name,email,phone,
                 department,job_title,employment_type,hire_date,basic_salary,is_active`,
      [
        req.user.company_id,body.branch_id || null,employeeCode,firstName,lastName,
        body.email || null,body.phone || null,body.department || null,body.job_title || null,
        contractType,hireDate,basicSalary,pii.national_id_encrypted,pii.kra_pin_encrypted,
        pii.nssf_number_encrypted,pii.sha_number_encrypted,pii.bank_account_no_encrypted,req.user.id,
      ],
    );
    const employeeId = employee.rows[0].id;
    await client.query(
      `INSERT INTO erp_employee_contracts (
         company_id,employee_id,contract_type,start_date,basic_salary,house_allowance,
         transport_allowance,status,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
      [req.user.company_id,employeeId,contractType,hireDate,basicSalary,
        Number(body.house_allowance || 0),Number(body.transport_allowance || 0),req.user.id],
    );
    const checklist = body.onboarding_checklist && typeof body.onboarding_checklist === "object"
      ? body.onboarding_checklist : {};
    const documents = Array.isArray(body.documents) ? body.documents.map((document) => ({
      document_type: String(document.document_type || "").slice(0, 80),
      storage_key: String(document.storage_key || "").slice(0, 240),
      verified: document.verified === true,
    })).filter((document) => document.document_type && document.storage_key) : [];
    await client.query(
      `INSERT INTO erp_employee_onboarding (company_id,employee_id,checklist,document_metadata,created_by,updated_by)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$5)`,
      [req.user.company_id,employeeId,JSON.stringify(checklist),JSON.stringify(documents),req.user.id],
    );
    await logAudit({
      companyId:req.user.company_id,userId:req.user.id,entityType:"erp_employees",
      entityId:employeeId,action:"employee_hired",
      newValues:{employee_code:employeeCode,employment_type:contractType,hire_date:hireDate},client,
    });
    await client.query("COMMIT");
    return res.status(201).json(employee.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Employee code or account already exists" });
    return res.status(400).json({ error: error.message || "Unable to hire employee" });
  } finally {
    client.release();
  }
});

router.post("/employees/:id/link-user", requirePermission("hr.approve"), async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "Enter the employee's login email" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employeeResult = await client.query(
      `SELECT id,employee_code,email,user_id FROM erp_employees
       WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE`,
      [req.params.id, req.user.company_id],
    );
    const employee = employeeResult.rows[0];
    if (!employee) throw new Error("Employee not found");
    if (employee.user_id) throw new Error("Employee already has a linked login account");
    if (String(employee.email || "").trim().toLowerCase() !== email) {
      throw new Error("Login email must exactly match the employee's recorded email");
    }
    const account = await client.query(
      `SELECT id,email FROM erp_users
       WHERE company_id=$1 AND LOWER(email)=LOWER($2) AND status='active' AND is_deleted=FALSE
       FOR UPDATE`,
      [req.user.company_id, email],
    );
    if (!account.rowCount) throw new Error("No active login account with that email exists in this company");
    const alreadyLinked = await client.query(
      "SELECT 1 FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_deleted=FALSE AND id<>$3",
      [req.user.company_id, account.rows[0].id, employee.id],
    );
    if (alreadyLinked.rowCount) throw new Error("Login account is already linked to another employee");
    await client.query(
      "UPDATE erp_employees SET user_id=$3,updated_by=$4,updated_at=NOW() WHERE id=$1 AND company_id=$2",
      [employee.id, req.user.company_id, account.rows[0].id, req.user.id],
    );
    await logAudit({
      client,
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_employees",
      entityId: employee.id,
      action: "employee_self_service_account_linked",
      newValues: { employee_code: employee.employee_code, user_id: account.rows[0].id },
    });
    await client.query("COMMIT");
    return res.json({ ok: true, employee_id: employee.id, user_id: account.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: error.message || "Unable to link employee account" });
  } finally {
    client.release();
  }
});

async function insertEmployeeClaim({ companyId, employeeId, userId, payload }) {
  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const category = typeof payload.category === "string" ? payload.category.trim().toUpperCase() : "GENERAL";
  const currencyCode = typeof payload.currency_code === "string" ? payload.currency_code.trim().toUpperCase() : "KES";
  const totalAmount = Number(payload.total_amount);
  const claimDate = payload.claim_date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(claimDate) || Number.isNaN(Date.parse(`${claimDate}T00:00:00Z`))
      || !description || description.length > 1000 || !/^[A-Z]{3}$/.test(currencyCode)
      || !Number.isFinite(totalAmount) || totalAmount <= 0 || !Number.isInteger(totalAmount * 100)) {
    throw new Error("Provide a valid claim date, description, three-letter currency and positive amount with at most two decimals");
  }
  const employee = await pool.query(
    "SELECT 1 FROM erp_employees WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [employeeId, companyId],
  );
  if (!employee.rowCount) throw new Error("Employee not found");
  const result = await pool.query(
    `INSERT INTO erp_employee_claims (
       company_id, employee_id, requested_by, claim_date, description,
       category, currency_code, total_amount, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted')
     RETURNING *`,
    [companyId, employeeId, userId, claimDate, description, category || "GENERAL", currencyCode, totalAmount],
  );
  await logAudit({
    companyId,
    userId,
    entityType: "erp_employee_claims",
    entityId: result.rows[0].id,
    action: "employee_claim_submitted",
    newValues: { employee_id: employeeId, amount: totalAmount, currency_code: currencyCode },
  });
  return result.rows[0];
}

router.get("/claims", requirePermission("hr.view"), async (req, res) => {
  const rows = await pool.query(
    `SELECT c.*, e.employee_code, e.first_name, e.last_name
     FROM erp_employee_claims c
     JOIN erp_employees e ON e.id = c.employee_id AND e.company_id = c.company_id
     WHERE c.company_id = $1 AND c.is_deleted = FALSE
     ORDER BY c.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(rows.rows);
});

router.post("/claims", requirePermission("hr.create"), async (req, res) => {
  try {
    if (!req.body?.employee_id) return res.status(400).json({ error: "employee_id is required" });
    const claim = await insertEmployeeClaim({
      companyId: req.user.company_id,
      employeeId: req.body.employee_id,
      userId: req.user.id,
      payload: req.body,
    });
    return res.status(201).json(claim);
  } catch (error) {
    return res.status(error.message === "Employee not found" ? 404 : 400).json({ error: error.message });
  }
});

router.get("/me/claims", async (req, res) => {
  const rows = await pool.query(
    `SELECT c.* FROM erp_employee_claims c
     JOIN erp_employees e ON e.id=c.employee_id AND e.company_id=c.company_id
     WHERE c.company_id=$1 AND e.user_id=$2 AND c.is_deleted=FALSE
     ORDER BY c.claim_date DESC,c.created_at DESC`,
    [req.user.company_id, req.user.id],
  );
  return res.json(rows.rows);
});

router.post("/me/claims", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  try {
    const claim = await insertEmployeeClaim({
      companyId: req.user.company_id,
      employeeId: employee.rows[0].id,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(claim);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/claims/:id/decision", requirePermission("hr.approve"), async (req, res) => {
  const decision = String(req.body?.decision || "").toLowerCase();
  const note = typeof req.body?.decision_note === "string" ? req.body.decision_note.trim() : "";
  const paymentReference = typeof req.body?.payment_reference === "string" ? req.body.payment_reference.trim() : "";
  if (!["approved", "rejected", "paid"].includes(decision)) return res.status(400).json({ error: "decision must be approved, rejected or paid" });
  if (decision === "paid" && !paymentReference) return res.status(400).json({ error: "payment_reference is required to mark a claim paid" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT * FROM erp_employee_claims WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE",
      [req.params.id, req.user.company_id],
    );
    if (!current.rowCount) throw new Error("Claim not found");
    const claim = current.rows[0];
    assertDifferentUser(claim.requested_by, req.user.id);
    const validTransition = (claim.status === "submitted" && ["approved", "rejected"].includes(decision))
      || (claim.status === "approved" && decision === "paid");
    if (!validTransition) throw new Error(`Cannot transition a ${claim.status} claim to ${decision}`);
    const updated = await client.query(
      `UPDATE erp_employee_claims
       SET status=$3,decision_note=COALESCE($4,decision_note),reviewed_by=$5,reviewed_at=NOW(),
           paid_at=CASE WHEN $3='paid' THEN NOW() ELSE paid_at END,
           payment_reference=CASE WHEN $3='paid' THEN $6 ELSE payment_reference END,updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [req.params.id, req.user.company_id, decision, note || null, req.user.id, paymentReference || null],
    );
    await logAudit({
      client,
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_employee_claims",
      entityId: req.params.id,
      action: `employee_claim_${decision}`,
      oldValues: { status: claim.status },
      newValues: { status: decision, payment_reference: decision === "paid" ? paymentReference : null },
    });
    await client.query("COMMIT");
    return res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.message === "Claim not found" ? 404 : 400).json({ error: error.message });
  } finally {
    client.release();
  }
});

const PROFILE_CHANGE_FIELDS = new Set(["department", "job_title", "email", "phone", "branch_id"]);

async function submitProfileChange({ companyId, employeeId, userId, fieldName, newValue }) {
  if (!PROFILE_CHANGE_FIELDS.has(fieldName)) throw new Error("This employee profile field cannot be changed through a request");
  if (fieldName === "branch_id") {
    if (typeof newValue !== "string") throw new Error("branch_id must identify a branch in this company");
    const branch = await pool.query(
      "SELECT 1 FROM erp_branches WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
      [newValue, companyId],
    );
    if (!branch.rowCount) throw new Error("Branch not found in this company");
  } else {
    if (typeof newValue !== "string" || !newValue.trim()) throw new Error("The requested profile value must be non-empty text");
    const value = newValue.trim();
    const maximumLength = fieldName === "email" ? 254 : fieldName === "phone" ? 40 : 120;
    if (value.length > maximumLength) throw new Error(`The requested ${fieldName} exceeds ${maximumLength} characters`);
    if (fieldName === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Provide a valid email address");
    newValue = value;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employee = await client.query(
      `SELECT id,department,job_title,email,phone,branch_id FROM erp_employees
       WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE`,
      [employeeId, companyId],
    );
    if (!employee.rowCount) throw new Error("Employee not found");
    const oldValue = employee.rows[0][fieldName] ?? null;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) throw new Error("The requested value is already current");
    const result = await client.query(
      `INSERT INTO erp_employee_profile_change_requests
         (company_id,employee_id,requested_by,field_name,old_value,new_value,status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'pending') RETURNING *`,
      [companyId, employeeId, userId, fieldName, JSON.stringify(oldValue), JSON.stringify(newValue)],
    );
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_employee_profile_change_requests",
      entityId: result.rows[0].id,
      action: "employee_profile_change_requested",
      newValues: { employee_id: employeeId, field_name: fieldName, new_value: newValue },
    });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

router.get("/profile-change-requests", requirePermission("hr.view"), async (req, res) => {
  const rows = await pool.query(
    `SELECT r.*, e.employee_code, e.first_name, e.last_name
     FROM erp_employee_profile_change_requests r
     JOIN erp_employees e ON e.id = r.employee_id AND e.company_id = r.company_id
     WHERE r.company_id = $1
     ORDER BY r.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(rows.rows);
});

router.post("/profile-change-requests", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  const employeeId = payload.employee_id;
  const fieldName = typeof payload.field_name === "string" ? payload.field_name.trim() : "";
  if (!employeeId || !fieldName || payload.new_value === undefined) {
    return res.status(400).json({ error: "employee_id, field_name and new_value are required" });
  }
  try {
    const request = await submitProfileChange({
      companyId: req.user.company_id,
      employeeId,
      userId: req.user.id,
      fieldName,
      newValue: payload.new_value,
    });
    return res.status(201).json(request);
  } catch (error) {
    return res.status(error.message === "Employee not found" ? 404 : 400).json({ error: error.message });
  }
});

router.get("/me/profile-change-requests", async (req, res) => {
  const rows = await pool.query(
    `SELECT r.* FROM erp_employee_profile_change_requests r
     JOIN erp_employees e ON e.id=r.employee_id AND e.company_id=r.company_id
     WHERE r.company_id=$1 AND e.user_id=$2 ORDER BY r.created_at DESC`,
    [req.user.company_id, req.user.id],
  );
  return res.json(rows.rows);
});

router.post("/me/profile-change-requests", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  const fieldName = typeof req.body?.field_name === "string" ? req.body.field_name.trim() : "";
  if (!fieldName || req.body?.new_value === undefined) return res.status(400).json({ error: "field_name and new_value are required" });
  try {
    const request = await submitProfileChange({
      companyId: req.user.company_id,
      employeeId: employee.rows[0].id,
      userId: req.user.id,
      fieldName,
      newValue: req.body.new_value,
    });
    return res.status(201).json(request);
  } catch (error) {
    return res.status(error.message === "Employee not found" ? 404 : 400).json({ error: error.message });
  }
});

router.post("/profile-change-requests/:id/decision", requirePermission("hr.approve"), async (req, res) => {
  const decision = String(req.body?.decision || "").toLowerCase();
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: "decision must be approved or rejected" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM erp_employee_profile_change_requests
       WHERE id=$1 AND company_id=$2 AND status='pending' FOR UPDATE`,
      [req.params.id, req.user.company_id],
    );
    if (!current.rowCount) throw new Error("Pending profile change request not found");
    const request = current.rows[0];
    assertDifferentUser(request.requested_by, req.user.id);
    if (!PROFILE_CHANGE_FIELDS.has(request.field_name)) throw new Error("The requested profile field is not supported");

    if (decision === "approved") {
      const employee = await client.query(
        `SELECT ${request.field_name} AS current_value FROM erp_employees
         WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE`,
        [request.employee_id, req.user.company_id],
      );
      if (!employee.rowCount) throw new Error("Employee not found");
      const currentValue = employee.rows[0].current_value ?? null;
      if (JSON.stringify(currentValue) !== JSON.stringify(request.old_value)) {
        throw new Error("Employee profile changed since this request was submitted; submit a new request");
      }
      const value = request.new_value;
      await client.query(
        `UPDATE erp_employees SET ${request.field_name}=$1${request.field_name === "branch_id" ? "::uuid" : ""},
           updated_by=$2,updated_at=NOW() WHERE id=$3 AND company_id=$4`,
        [value, req.user.id, request.employee_id, req.user.company_id],
      );
    }

    const updated = await client.query(
      `UPDATE erp_employee_profile_change_requests
       SET status=$3,decision_note=$4,reviewed_by=$5,reviewed_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [req.params.id, req.user.company_id, decision,
        typeof req.body?.decision_note === "string" ? req.body.decision_note.trim() || null : null, req.user.id],
    );
    await logAudit({
      client,
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_employee_profile_change_requests",
      entityId: req.params.id,
      action: `employee_profile_change_${decision}`,
      oldValues: { field_name: request.field_name, value: request.old_value },
      newValues: { status: decision, value: decision === "approved" ? request.new_value : request.old_value },
    });
    await client.query("COMMIT");
    return res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.message.includes("not found") ? 404 : 400).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get("/payroll/leave-rules", requirePermission("hr.view"), async (req, res) => {
  const rows = await pool.query(
    `SELECT r.*, lt.name AS leave_type_name, lt.code AS leave_type_code
     FROM erp_payroll_leave_rules r
     JOIN erp_leave_types lt ON lt.id = r.leave_type_id AND lt.company_id = r.company_id
     WHERE r.company_id = $1 AND r.is_active = TRUE
     ORDER BY lt.name`,
    [req.user.company_id],
  );
  return res.json(rows.rows);
});

router.post("/payroll/leave-rules", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  const leaveTypeId = payload.leave_type_id;
  if (!leaveTypeId) return res.status(400).json({ error: "leave_type_id is required" });
  const deductionPercent = payload.payroll_deduction_percent === undefined ? 0 : Number(payload.payroll_deduction_percent);
  const minimumBalanceDays = payload.minimum_balance_days === undefined ? 0 : Number(payload.minimum_balance_days);
  const effectiveFrom = payload.effective_from || new Date().toISOString().slice(0, 10);
  const isValidIsoDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!Number.isFinite(deductionPercent) || deductionPercent < 0 || deductionPercent > 100
      || !Number.isFinite(minimumBalanceDays) || minimumBalanceDays < 0
      || !isValidIsoDate(effectiveFrom)
      || (payload.paid_leave_requires_balance !== undefined && typeof payload.paid_leave_requires_balance !== "boolean")) {
    return res.status(400).json({ error: "Provide a deduction percentage from 0 to 100, a nonnegative balance threshold, a valid effective date and a boolean balance requirement" });
  }

  const exists = await pool.query(
    "SELECT 1 FROM erp_leave_types WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [leaveTypeId, req.user.company_id],
  );
  if (!exists.rowCount) return res.status(404).json({ error: "Leave type not found" });

  const result = await pool.query(
    `INSERT INTO erp_payroll_leave_rules (
       company_id, leave_type_id, payroll_deduction_percent, paid_leave_requires_balance,
       minimum_balance_days, effective_from, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (company_id,leave_type_id,effective_from) DO UPDATE
       SET payroll_deduction_percent=EXCLUDED.payroll_deduction_percent,
           paid_leave_requires_balance=EXCLUDED.paid_leave_requires_balance,
           minimum_balance_days=EXCLUDED.minimum_balance_days,is_active=TRUE,updated_at=NOW()
     RETURNING *`,
    [req.user.company_id, leaveTypeId, deductionPercent, payload.paid_leave_requires_balance !== false,
      minimumBalanceDays, effectiveFrom, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.patch("/payroll/leave-rules/:id/status", requirePermission("hr.create"), async (req, res) => {
  if (typeof req.body?.is_active !== "boolean") return res.status(400).json({ error: "is_active must be a boolean" });
  const result = await pool.query(
    `UPDATE erp_payroll_leave_rules SET is_active=$3,updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [req.params.id, req.user.company_id, req.body.is_active],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Payroll leave rule not found" });
  return res.json(result.rows[0]);
});

router.get("/future-events", requirePermission("hr.view"), async (req, res) => {
  const rows = await pool.query(
    `SELECT * FROM erp_hr_future_effective_events
     WHERE company_id = $1 AND status IN ('pending','scheduled')
     ORDER BY effective_from ASC, created_at DESC`,
    [req.user.company_id],
  );
  return res.json(rows.rows);
});

router.post("/future-events", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  const parsedEffectiveDate = typeof payload.effective_date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(payload.effective_date)
    ? new Date(`${payload.effective_date}T00:00:00.000Z`)
    : null;
  const validDate = typeof payload.effective_date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(payload.effective_date)
    && parsedEffectiveDate !== null
    && !Number.isNaN(parsedEffectiveDate.getTime())
    && parsedEffectiveDate.toISOString().slice(0, 10) === payload.effective_date
    && payload.effective_date >= new Date().toISOString().slice(0, 10);
  if (payload.entity_type !== "erp_employees" || !payload.entity_id
      || !SCHEDULED_EMPLOYEE_FIELDS.has(payload.field_name) || !validDate
      || !Object.hasOwn(payload, "new_value")) {
    return res.status(400).json({ error: "entity_type, entity_id, field_name and effective_date are required" });
  }

  const employee = await pool.query(
    `SELECT ${payload.field_name} AS current_value FROM erp_employees
     WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE`,
    [payload.entity_id, req.user.company_id],
  );
  if (!employee.rowCount) return res.status(404).json({ error: "Employee not found" });
  if (payload.field_name === "branch_id" && payload.new_value != null) {
    const branch = await pool.query(
      "SELECT 1 FROM erp_branches WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
      [payload.new_value, req.user.company_id],
    );
    if (!branch.rowCount) return res.status(400).json({ error: "Branch not found in this company" });
  } else if (payload.field_name !== "branch_id" && payload.new_value != null && typeof payload.new_value !== "string") {
    return res.status(400).json({ error: "Employee profile values must be text or null" });
  }
  const row = await pool.query(
    `INSERT INTO erp_hr_future_effective_events (
       company_id, entity_type, entity_id, field_name, old_value, new_value, effective_from, created_by, status
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,'pending')
     RETURNING *`,
    [req.user.company_id, payload.entity_type, payload.entity_id, payload.field_name,
      JSON.stringify(employee.rows[0].current_value ?? null), JSON.stringify(payload.new_value), payload.effective_date, req.user.id],
  );
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_hr_future_effective_events",
    entityId: row.rows[0].id,
    action: "hr_future_event_requested",
    newValues: { employee_id: payload.entity_id, field_name: payload.field_name, effective_from: payload.effective_date },
  });
  return res.status(201).json(row.rows[0]);
});

router.post("/future-events/:id/decision", requirePermission("hr.approve"), async (req, res) => {
  const decision = String(req.body?.decision || "").toLowerCase();
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "decision must be approved or rejected" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM erp_hr_future_effective_events
       WHERE id=$1 AND company_id=$2 AND status='pending' FOR UPDATE`,
      [req.params.id, req.user.company_id],
    );
    if (!current.rowCount) throw new Error("Pending future event not found");
    const event = current.rows[0];
    assertDifferentUser(event.created_by, req.user.id);
    const status = decision === "approved" ? "scheduled" : "cancelled";
    const updated = await client.query(
      `UPDATE erp_hr_future_effective_events
       SET status=$3,decision_note=$4,reviewed_by=$5,reviewed_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [req.params.id, req.user.company_id, status,
        typeof req.body?.decision_note === "string" ? req.body.decision_note.trim() || null : null, req.user.id],
    );
    await logAudit({
      client,
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_hr_future_effective_events",
      entityId: req.params.id,
      action: `hr_future_event_${decision}`,
      oldValues: { status: "pending" },
      newValues: { status },
    });
    await client.query("COMMIT");
    return res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.message.includes("not found") ? 404 : 400).json({ error: error.message });
  } finally {
    client.release();
  }
});

const HR_RETENTION_DATA_TYPES = new Set([
  "employee_documents",
  "employee_dependants",
  "employee_claims",
  "profile_change_requests",
  "attendance",
]);

router.get("/retention-policies", requirePermission("hr.view"), async (req, res) => {
  const rows = await pool.query(
    `SELECT * FROM erp_hr_retention_policies
     WHERE company_id = $1
     ORDER BY policy_name`,
    [req.user.company_id],
  );
  return res.json(rows.rows);
});

router.post("/retention-policies", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  const policyName = typeof payload.policy_name === "string" ? payload.policy_name.trim() : "";
  const dataType = typeof payload.data_type === "string" ? payload.data_type.trim() : "";
  const retentionDays = Number(payload.retention_days);
  if (!policyName || policyName.length > 120 || !HR_RETENTION_DATA_TYPES.has(dataType)
      || !Number.isInteger(retentionDays) || retentionDays <= 0
      || (payload.archival_required !== undefined && typeof payload.archival_required !== "boolean")) {
    return res.status(400).json({ error: "policy_name, data_type and retention_days are required" });
  }
  const row = await pool.query(
    `INSERT INTO erp_hr_retention_policies (
       company_id, policy_name, data_type, retention_days, archival_required, description, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (company_id,policy_name) DO UPDATE
       SET data_type=EXCLUDED.data_type,retention_days=EXCLUDED.retention_days,
           archival_required=EXCLUDED.archival_required,description=EXCLUDED.description,
           status='active',updated_at=NOW()
     RETURNING *`,
    [req.user.company_id, policyName, dataType, retentionDays, payload.archival_required ?? false,
      typeof payload.description === "string" ? payload.description.trim() || null : null, req.user.id],
  );
  return res.status(201).json(row.rows[0]);
});

router.patch("/retention-policies/:id/status", requirePermission("hr.create"), async (req, res) => {
  const status = String(req.body?.status || "").toLowerCase();
  if (!["active", "inactive"].includes(status)) return res.status(400).json({ error: "status must be active or inactive" });
  const result = await pool.query(
    `UPDATE erp_hr_retention_policies SET status=$3,updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [req.params.id, req.user.company_id, status],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Retention policy not found" });
  return res.json(result.rows[0]);
});

router.get("/me", async (req, res) => {
  const employee = await pool.query(
    `SELECT e.id,e.employee_code,e.first_name,e.last_name,e.email,e.phone,e.department,
            e.job_title,e.employment_type,e.hire_date,e.basic_salary,e.branch_id,b.name AS branch_name
     FROM erp_employees e
     LEFT JOIN erp_branches b ON b.id=e.branch_id AND b.company_id=e.company_id
     WHERE e.company_id=$1 AND e.user_id=$2 AND e.is_active=TRUE AND e.is_deleted=FALSE`,
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  return res.json(employee.rows[0]);
});

router.get("/me/attendance", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  const result = await pool.query(
    `SELECT id,attendance_date,check_in,check_out,hours_worked,overtime_hours,status,approval_status
     FROM erp_attendance
     WHERE company_id=$1 AND employee_id=$2 AND is_deleted=FALSE
     ORDER BY attendance_date DESC LIMIT 180`,
    [req.user.company_id, employee.rows[0].id],
  );
  return res.json(result.rows);
});

router.get("/me/leave-applications", async (req, res) => {
  const result = await pool.query(
    `SELECT application.id,application.application_no,application.start_date,application.end_date,
            application.days_requested,application.status,application.reason,application.decision_note,
            application.created_at,type.code AS leave_type_code,type.name AS leave_type_name
     FROM erp_leave_applications application
     JOIN erp_employees employee ON employee.id=application.employee_id AND employee.company_id=application.company_id
     JOIN erp_leave_types type ON type.id=application.leave_type_id AND type.company_id=application.company_id
     WHERE application.company_id=$1 AND employee.user_id=$2 AND employee.is_deleted=FALSE
       AND application.is_deleted=FALSE
     ORDER BY application.start_date DESC,application.created_at DESC LIMIT 100`,
    [req.user.company_id, req.user.id],
  );
  return res.json(result.rows);
});

router.get("/me/leave-types", async (req, res) => {
  const result = await pool.query(
    `SELECT type.id,type.code,type.name,type.days_per_year,type.is_paid,type.accrual_method,type.encashment_allowed
     FROM erp_leave_types type
     JOIN erp_employees employee ON employee.company_id=type.company_id
     WHERE employee.user_id=$1 AND employee.company_id=$2 AND employee.is_active=TRUE
       AND employee.is_deleted=FALSE AND type.is_active=TRUE AND type.is_deleted=FALSE
     ORDER BY type.name`,
    [req.user.id, req.user.company_id],
  );
  if (!result.rowCount) {
    const linked = await pool.query(
      "SELECT 1 FROM erp_employees WHERE user_id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
      [req.user.id, req.user.company_id],
    );
    if (!linked.rowCount) return res.status(404).json({ error: "No active employee profile is linked to this login" });
  }
  return res.json(result.rows);
});

router.get("/me/leave-balances", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) {
    return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  }
  const balances = await getLeaveBalancesForEmployee(req.user.company_id, employee.rows[0].id);
  return res.json(balances);
});

router.post("/me/leave-balances/encash", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) {
    return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  }

  const leaveTypeId = typeof req.body?.leave_type_id === "string" ? req.body.leave_type_id : "";
  const days = Number(req.body?.days ?? 0);
  if (!leaveTypeId || !Number.isFinite(days) || days <= 0) {
    return res.status(400).json({ error: "leave_type_id and positive days are required" });
  }

  const type = await pool.query(
    `SELECT id, encashment_allowed FROM erp_leave_types
     WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE`,
    [leaveTypeId, req.user.company_id],
  );
  if (!type.rowCount || !type.rows[0].encashment_allowed) {
    return res.status(400).json({ error: "This leave type does not allow encashment" });
  }

  const balance = await pool.query(
    `SELECT id, balance_days, carryover_days FROM erp_leave_balances
     WHERE company_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND is_deleted=FALSE
     FOR UPDATE`,
    [req.user.company_id, employee.rows[0].id, leaveTypeId],
  );
  if (!balance.rowCount) {
    return res.status(404).json({ error: "No leave balance exists for this leave type" });
  }

  const available = Number(balance.rows[0].balance_days || 0) + Number(balance.rows[0].carryover_days || 0);
  if (days > available) {
    return res.status(400).json({ error: "Encashment request exceeds the available leave balance" });
  }

  const remaining = Number((available - days).toFixed(2));
  await pool.query(
    `UPDATE erp_leave_balances
     SET balance_days=$3, carryover_days=0, updated_by=$4, updated_at=NOW()
     WHERE id=$1 AND company_id=$2`,
    [balance.rows[0].id, req.user.company_id, remaining, req.user.id],
  );

  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_leave_balances",
    entityId: balance.rows[0].id,
    action: "leave_balance_encashed",
    newValues: { leave_type_id: leaveTypeId, encashed_days: days, remaining_balance: remaining },
  });

  return res.json({
    ok: true,
    leave_type_id: leaveTypeId,
    encashed_days: Number(days.toFixed(2)),
    remaining_balance: remaining,
  });
});

router.post("/me/leave-applications", async (req, res) => {
  const { leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate, days_requested: daysRequestedRaw, reason: reasonRaw } = req.body || {};
  const daysRequested = Number(daysRequestedRaw);
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  const validDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!leaveTypeId || !validDate(startDate) || !validDate(endDate) || endDate < startDate
      || !Number.isFinite(daysRequested) || daysRequested <= 0 || reason.length < 3 || reason.length > 1000) {
    return res.status(400).json({ error: "Provide a leave type, valid date range, positive requested days, and reason" });
  }
  const calendarDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  if (daysRequested > calendarDays) return res.status(400).json({ error: "Requested leave days exceed the selected date range" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employee = await client.query(
      `SELECT id FROM erp_employees
       WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE FOR UPDATE`,
      [req.user.company_id, req.user.id],
    );
    if (employee.rowCount !== 1) throw new Error("No unique active employee profile is linked to this login");
    const employeeId = employee.rows[0].id;
    const type = await client.query(
      "SELECT id FROM erp_leave_types WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
      [leaveTypeId, req.user.company_id],
    );
    if (!type.rowCount) throw new Error("Choose an active leave type in this company");
    const overlap = await client.query(
      `SELECT 1 FROM erp_leave_applications
       WHERE company_id=$1 AND employee_id=$2 AND is_deleted=FALSE
         AND status IN ('pending','approved') AND start_date <= $4::date AND end_date >= $3::date
       LIMIT 1`,
      [req.user.company_id, employeeId, startDate, endDate],
    );
    if (overlap.rowCount) throw new Error("This leave period overlaps a pending or approved request");
    const applicationNo = await nextDocumentNo(client, {
      companyId: req.user.company_id,
      docType: "erp_leave_applications",
      prefix: "LA",
    });
    const inserted = await client.query(
      `INSERT INTO erp_leave_applications
         (company_id,employee_id,leave_type_id,application_no,start_date,end_date,days_requested,reason,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,application_no,start_date,end_date,days_requested,status,reason,created_at`,
      [req.user.company_id, employeeId, leaveTypeId, applicationNo, startDate, endDate, daysRequested, reason, req.user.id],
    );
    await logAudit({
      client,
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_leave_applications",
      entityId: inserted.rows[0].id,
      action: "employee_self_leave_requested",
      newValues: { application_no: applicationNo, leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate, days_requested: daysRequested },
    });
    await client.query("COMMIT");
    return res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: error.message || "Unable to submit leave request" });
  } finally {
    client.release();
  }
});

router.get("/me/payslips", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });
  const result = await pool.query(
    `SELECT slip.id,run.run_no,run.payroll_month,run.released_at,
            slip.gross_pay,slip.paye,slip.shif,slip.nhif,slip.nssf,slip.nssf_tier1,
            slip.nssf_tier2,slip.nssf_employer,slip.housing_levy,slip.housing_levy_employer,
            slip.taxable_income,slip.personal_relief,slip.insurance_relief,slip.employer_cost,
            slip.net_pay,slip.earnings_detail,slip.deductions_detail
     FROM erp_payslips slip
     JOIN erp_payroll_runs run ON run.id=slip.payroll_run_id AND run.company_id=slip.company_id
     WHERE slip.company_id=$1 AND slip.employee_id=$2 AND slip.is_deleted=FALSE
       AND run.is_deleted=FALSE AND run.status='released'
     ORDER BY run.payroll_month DESC LIMIT 36`,
    [req.user.company_id, employee.rows[0].id],
  );
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_employees",
    entityId: employee.rows[0].id,
    action: "employee_self_payslips_viewed",
    newValues: { payslip_count: result.rowCount },
    ipAddress: req.clientIp,
    userAgent: req.headers["user-agent"],
  });
  return res.json(result.rows);
});

router.get("/me/onboarding", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });

  const result = await pool.query(
    `SELECT * FROM erp_employee_onboarding
     WHERE company_id=$1 AND employee_id=$2`,
    [req.user.company_id, employee.rows[0].id],
  );

  if (!result.rowCount) {
    return res.json({
      company_id: req.user.company_id,
      employee_id: employee.rows[0].id,
      status: "in_progress",
      checklist: {},
      document_metadata: [],
      completed_at: null,
      created_at: null,
      updated_at: null,
    });
  }
  return res.json(result.rows[0]);
});

router.get("/me/documents", async (req, res) => {
  const employee = await pool.query(
    "SELECT id FROM erp_employees WHERE company_id=$1 AND user_id=$2 AND is_active=TRUE AND is_deleted=FALSE",
    [req.user.company_id, req.user.id],
  );
  if (employee.rowCount !== 1) return res.status(404).json({ error: "No unique active employee profile is linked to this login" });

  const result = await pool.query(
    `SELECT * FROM erp_employee_documents
     WHERE company_id=$1 AND employee_id=$2
     ORDER BY created_at DESC`,
    [req.user.company_id, employee.rows[0].id],
  );
  return res.json(result.rows);
});

router.get("/employees/:id/onboarding", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_employee_onboarding WHERE company_id=$1 AND employee_id=$2`,
    [req.user.company_id, req.params.id],
  );
  if (!result.rowCount) {
    return res.json({
      company_id: req.user.company_id,
      employee_id: req.params.id,
      status: "in_progress",
      checklist: {},
      document_metadata: [],
      completed_at: null,
      created_at: null,
      updated_at: null,
    });
  }
  return res.json(result.rows[0]);
});

router.put("/employees/:id/onboarding", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  const checklist = payload.checklist && typeof payload.checklist === "object" && !Array.isArray(payload.checklist)
    ? payload.checklist
    : {};
  const documentMetadata = Array.isArray(payload.document_metadata) ? payload.document_metadata : [];
  const status = String(payload.status || "in_progress");
  if (!['in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'in_progress' or 'completed'" });
  }

  const employee = await pool.query(
    "SELECT 1 FROM erp_employees WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
    [req.params.id, req.user.company_id],
  );
  if (!employee.rowCount) return res.status(404).json({ error: "Employee not found" });

  const result = await pool.query(
    `INSERT INTO erp_employee_onboarding (company_id, employee_id, checklist, document_metadata, status, completed_at, created_by, updated_by)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$7)
     ON CONFLICT (employee_id) DO UPDATE SET
       checklist = EXCLUDED.checklist,
       document_metadata = EXCLUDED.document_metadata,
       status = EXCLUDED.status,
       completed_at = EXCLUDED.completed_at,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      req.user.company_id,
      req.params.id,
      JSON.stringify(checklist),
      JSON.stringify(documentMetadata),
      status,
      status === "completed" ? new Date().toISOString() : null,
      req.user.id,
    ],
  );
  return res.json(result.rows[0]);
});

router.get("/employees/:id/documents", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_employee_documents
     WHERE company_id=$1 AND employee_id=$2 ORDER BY created_at DESC`,
    [req.user.company_id, req.params.id],
  );
  return res.json(result.rows);
});

router.post("/employees/:id/documents", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  const documentType = typeof payload.document_type === "string" ? payload.document_type.trim() : "";
  if (!documentType) return res.status(400).json({ error: "document_type is required" });

  const employee = await pool.query(
    "SELECT 1 FROM erp_employees WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
    [req.params.id, req.user.company_id],
  );
  if (!employee.rowCount) return res.status(404).json({ error: "Employee not found" });

  const result = await pool.query(
    `INSERT INTO erp_employee_documents (
       company_id, employee_id, document_type, document_name, file_url, expiry_date, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'active'),$8)
     RETURNING *`,
    [
      req.user.company_id,
      req.params.id,
      documentType,
      typeof payload.document_name === "string" ? payload.document_name : null,
      typeof payload.file_url === "string" ? payload.file_url : null,
      payload.expiry_date || null,
      payload.status || "active",
      req.user.id,
    ],
  );

  return res.status(201).json(result.rows[0]);
});

router.get("/employees/:id/lifecycle-events", requirePermission("hr.view"), async (req, res) => {
  try {
    const employee = await pool.query(
      "SELECT 1 FROM erp_employees WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
      [req.params.id, req.user.company_id],
    );
    if (!employee.rowCount) return res.status(404).json({ error: "Employee not found" });
    return res.json(await employeeLifecycle.listLifecycleEvents({
      companyId: req.user.company_id,
      employeeId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load employee lifecycle history" });
  }
});

router.post("/employees/:id/lifecycle-events", requirePermission("hr.create"), async (req, res) => {
  try {
    const event = await employeeLifecycle.requestLifecycleEvent({
      companyId: req.user.company_id,
      userId: req.user.id,
      employeeId: req.params.id,
      eventType: req.body?.event_type,
      effectiveDate: req.body?.effective_date,
      requestedValues: req.body?.requested_values,
    });
    return res.status(201).json(event);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to request employee lifecycle change" });
  }
});

router.post("/employee-lifecycle-events/:id/decision", requirePermission("hr.approve"), async (req, res) => {
  try {
    const event = await employeeLifecycle.decideLifecycleEvent({
      companyId: req.user.company_id,
      userId: req.user.id,
      eventId: req.params.id,
      decision: req.body?.decision,
      decisionNote: req.body?.decision_note,
    });
    return res.json(event);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to decide employee lifecycle request" });
  }
});

router.post("/employee-lifecycle-events/:id/apply", requirePermission("hr.approve"), async (req, res) => {
  try {
    return res.json(await employeeLifecycle.applyLifecycleEvent({
      companyId: req.user.company_id,
      userId: req.user.id,
      eventId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to apply employee lifecycle change" });
  }
});

router.get("/employees/:id/sensitive", requirePermission("hr.approve"), async (req, res) => {
  const purpose = typeof req.query.purpose === "string" ? req.query.purpose.trim() : "";
  if (purpose.length < 10) return res.status(400).json({ error: "Provide a specific purpose of at least 10 characters" });
  const result = await pool.query(
    `SELECT id,employee_code,national_id_encrypted,kra_pin_encrypted,
            nssf_number_encrypted,sha_number_encrypted,bank_account_no_encrypted
     FROM erp_employees WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE`,
    [req.params.id,req.user.company_id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Employee not found" });
  const row = result.rows[0];
  const fields = ["national_id", "kra_pin", "nssf_number", "sha_number", "bank_account_no"];
  await pool.query(
    `INSERT INTO erp_employee_pii_access_log (company_id,employee_id,accessed_by,fields,purpose,ip_address,user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user.company_id,row.id,req.user.id,fields,purpose,req.clientIp || null,req.headers["user-agent"] || null],
  );
  await logAudit({
    companyId:req.user.company_id,userId:req.user.id,entityType:"erp_employees",
    entityId:row.id,action:"employee_sensitive_data_accessed",
    newValues:{fields,purpose},ipAddress:req.clientIp,userAgent:req.headers["user-agent"],
  });
  try {
    return res.json({
      employee_id:row.id,
      employee_code:row.employee_code,
      national_id:decryptEmployeeValue(row.national_id_encrypted),
      kra_pin:decryptEmployeeValue(row.kra_pin_encrypted),
      nssf_number:decryptEmployeeValue(row.nssf_number_encrypted),
      sha_number:decryptEmployeeValue(row.sha_number_encrypted),
      bank_account_no:decryptEmployeeValue(row.bank_account_no_encrypted),
    });
  } catch (error) {
    return res.status(500).json({ error: "Employee sensitive data could not be decrypted" });
  }
});

router.get("/org-chart", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.job_title, e.department,
            e.manager_id, m.first_name AS manager_first, m.last_name AS manager_last
     FROM erp_employees e
     LEFT JOIN erp_employees m ON m.id = e.manager_id
     WHERE e.company_id = $1 AND e.is_active = TRUE AND e.is_deleted = FALSE
     ORDER BY e.department, e.last_name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/attendance", requirePermission("hr.view"), async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const result = await pool.query(
    `SELECT a.id, a.employee_id, e.employee_code, e.first_name, e.last_name, e.department,
            a.attendance_date, a.check_in, a.check_out, a.hours_worked, a.overtime_hours, a.status
     FROM erp_attendance a
     JOIN erp_employees e ON e.id = a.employee_id
     WHERE a.company_id = $1 AND e.is_deleted = FALSE
       AND ($2::date IS NULL OR a.attendance_date >= $2::date)
       AND ($3::date IS NULL OR a.attendance_date <= $3::date)
     ORDER BY a.attendance_date DESC, e.last_name, e.first_name LIMIT 500`,
    [req.user.company_id, from, to],
  );
  return res.json(result.rows);
});

router.get("/leave-types", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM erp_leave_types WHERE company_id = $1 AND is_deleted = FALSE ORDER BY name",
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/leave-applications", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT la.*, e.first_name, e.last_name, lt.name AS leave_type_name
     FROM erp_leave_applications la
     JOIN erp_employees e ON e.id = la.employee_id
     JOIN erp_leave_types lt ON lt.id = la.leave_type_id
     WHERE la.company_id = $1 AND la.is_deleted = FALSE ORDER BY la.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/leave-applications", requirePermission("hr.create"), async (req, res) => {
  const { employee_id, leave_type_id, start_date, end_date, days_requested, reason } =
    req.body || {};
  if (!employee_id || !leave_type_id || !start_date || !end_date) {
    return res
      .status(400)
      .json({ error: "employee_id, leave_type_id, start_date, end_date required" });
  }
  const countR = await pool.query(
    "SELECT COUNT(*)::int AS n FROM erp_leave_applications WHERE company_id = $1",
    [req.user.company_id],
  );
  const applicationNo = `LA-${new Date().getFullYear()}-${String(Number(countR.rows[0].n) + 1).padStart(4, "0")}`;
  const result = await pool.query(
    `INSERT INTO erp_leave_applications (
       company_id, employee_id, leave_type_id, application_no, start_date, end_date,
       days_requested, reason, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),$8,$9) RETURNING *`,
    [
      req.user.company_id,
      employee_id,
      leave_type_id,
      applicationNo,
      start_date,
      end_date,
      days_requested,
      reason,
      req.user.id,
    ],
  );
  return res.status(201).json(result.rows[0]);
});

router.post(
  "/leave-applications/:id/approve",
  requirePermission("hr.approve"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const app = await client.query(
        `SELECT * FROM erp_leave_applications WHERE id = $1 AND company_id = $2 AND status = 'pending' FOR UPDATE`,
        [req.params.id, req.user.company_id],
      );
      if (!app.rowCount) throw new Error("Application not found");
      assertDifferentUser(app.rows[0].created_by, req.user.id);

      const leaveType = await client.query(
        "SELECT is_paid FROM erp_leave_types WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        [app.rows[0].leave_type_id, req.user.company_id],
      );
      if (!leaveType.rowCount) throw new Error("Leave type no longer exists");
      const rule = await client.query(
        `SELECT paid_leave_requires_balance,minimum_balance_days
         FROM erp_payroll_leave_rules
         WHERE company_id=$1 AND leave_type_id=$2 AND is_active=TRUE
           AND effective_from <= $3::date
         ORDER BY effective_from DESC LIMIT 1`,
        [req.user.company_id, app.rows[0].leave_type_id, app.rows[0].start_date],
      );
      const requiresBalance = rule.rows[0]?.paid_leave_requires_balance ?? true;
      const minimumBalance = Number(rule.rows[0]?.minimum_balance_days ?? 0);
      if (leaveType.rows[0].is_paid && requiresBalance) {
        const balance = await client.query(
          `SELECT id,balance_days FROM erp_leave_balances
           WHERE employee_id=$1 AND leave_type_id=$2 AND company_id=$3 AND is_deleted=FALSE
           FOR UPDATE`,
          [app.rows[0].employee_id, app.rows[0].leave_type_id, req.user.company_id],
        );
        if (!balance.rowCount) throw new Error("No leave balance is configured for this employee and leave type");
        const remainingBalance = Number(balance.rows[0].balance_days) - Number(app.rows[0].days_requested);
        if (remainingBalance < minimumBalance) {
          throw new Error(`The employee must retain at least ${minimumBalance} leave days after approval`);
        }
        await client.query(
          `UPDATE erp_leave_balances SET balance_days=balance_days-$3,updated_at=NOW(),updated_by=$4
           WHERE id=$1 AND company_id=$2`,
          [balance.rows[0].id, req.user.company_id, app.rows[0].days_requested, req.user.id],
        );
      }

      await client.query(
        `UPDATE erp_leave_applications SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.company_id, req.user.id],
      );

      await logAudit({ client, companyId: req.user.company_id, userId: req.user.id,
        entityType: "erp_leave_applications", entityId: req.params.id, action: "leave_application_approved",
        newValues: { status: "approved", days_requested: Number(app.rows[0].days_requested) } });

      await client.query("COMMIT");
      return res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  },
);

router.get("/org/departments", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_org_departments WHERE company_id = $1 ORDER BY name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/org/departments", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.code || !payload.name) return res.status(400).json({ error: "Department code and name are required" });
  const result = await pool.query(
    `INSERT INTO erp_org_departments (company_id, parent_id, code, name, description, status, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'active'), $7)
     RETURNING *`,
    [req.user.company_id, payload.parent_id || null, payload.code, payload.name, payload.description || null, payload.status || "active", req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.get("/org/positions", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, d.name AS department_name FROM erp_org_positions p
     LEFT JOIN erp_org_departments d ON d.id = p.department_id
     WHERE p.company_id = $1 ORDER BY p.title`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/org/positions", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.code || !payload.title) return res.status(400).json({ error: "Position code and title are required" });
  const result = await pool.query(
    `INSERT INTO erp_org_positions (company_id, department_id, code, title, grade, status, headcount_budget, filled_count, reports_to, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'active'), COALESCE($7, 1), COALESCE($8, 0), $9, $10)
     RETURNING *`,
    [req.user.company_id, payload.department_id || null, payload.code, payload.title, payload.grade || null, payload.status || "active", Number(payload.headcount_budget || 1), Number(payload.filled_count || 0), payload.reports_to || null, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.get("/org/chart", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.title, p.department_id, p.reports_to, p.headcount_budget, p.filled_count,
            d.name AS department_name
     FROM erp_org_positions p
     LEFT JOIN erp_org_departments d ON d.id = p.department_id
     WHERE p.company_id = $1 AND p.status <> 'closed' ORDER BY p.title`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/recruitment/requisitions", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_manpower_requisitions WHERE company_id = $1 ORDER BY created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/recruitment/requisitions", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.requisition_no || !payload.position_id) return res.status(400).json({ error: "Requisition number and position are required" });
  const result = await pool.query(
    `INSERT INTO erp_manpower_requisitions (company_id, requisition_no, position_id, department_id, requested_by, reason, headcount_needed, urgency, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7,1), COALESCE($8, 'normal'), 'draft', $9)
     RETURNING *`,
    [req.user.company_id, payload.requisition_no, payload.position_id, payload.department_id || null, req.user.id, payload.reason || null, Number(payload.headcount_needed || 1), payload.urgency || "normal", req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.get("/recruitment/vacancies", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_vacancies WHERE company_id = $1 ORDER BY closing_date NULLS LAST`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/recruitment/vacancies", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.title || !payload.position_id) return res.status(400).json({ error: "Vacancy title and position are required" });
  const result = await pool.query(
    `INSERT INTO erp_vacancies (company_id, position_id, department_id, title, description, closing_date, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7,'open'), $8)
     RETURNING *`,
    [req.user.company_id, payload.position_id, payload.department_id || null, payload.title, payload.description || null, payload.closing_date || null, payload.status || "open", req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.get("/recruitment/candidates", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_candidates WHERE company_id = $1 ORDER BY created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/recruitment/candidates", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.vacancy_id || !payload.first_name || !payload.last_name) return res.status(400).json({ error: "Vacancy, first name and last name are required" });
  const result = await pool.query(
    `INSERT INTO erp_candidates (company_id, vacancy_id, first_name, last_name, email, phone, cv_url, consent_signed, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, FALSE), COALESCE($9, 'applied'), $10)
     RETURNING *`,
    [req.user.company_id, payload.vacancy_id, payload.first_name, payload.last_name, payload.email || null, payload.phone || null, payload.cv_url || null, Boolean(payload.consent_signed), payload.status || "applied", req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/recruitment/offers", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.candidate_id || !payload.offer_no) return res.status(400).json({ error: "Candidate and offer number are required" });
  const result = await pool.query(
    `INSERT INTO erp_candidate_offers (company_id, candidate_id, offer_no, proposed_salary, status, approved_by)
     VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, 'draft'), $6)
     RETURNING *`,
    [req.user.company_id, payload.candidate_id, payload.offer_no, Number(payload.proposed_salary || 0), payload.status || "draft", req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/recruitment/convert-candidate", requirePermission("hr.create"), async (req, res) => {
  const payload = req.body || {};
  if (!payload.candidate_id || !payload.employee_code || !payload.first_name || !payload.last_name || !payload.hire_date) {
    return res.status(400).json({ error: "Candidate, employee code, name and hire date are required" });
  }
  const candidate = await pool.query(
    `SELECT * FROM erp_candidates WHERE id = $1 AND company_id = $2`,
    [payload.candidate_id, req.user.company_id],
  );
  if (!candidate.rowCount) return res.status(404).json({ error: "Candidate not found" });

  const employee = await pool.query(
    `INSERT INTO erp_employees (
       company_id, employee_code, first_name, last_name, email, phone, department, job_title,
       employment_type, hire_date, basic_salary, created_by, is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
     RETURNING *`,
    [req.user.company_id, payload.employee_code, payload.first_name, payload.last_name, payload.email || candidate.rows[0].email || null, payload.phone || candidate.rows[0].phone || null, payload.department || null, payload.job_title || null, payload.contract_type || "probation", payload.hire_date, Number(payload.basic_salary || 0), req.user.id],
  );

  await pool.query(
    `INSERT INTO erp_employee_contracts (company_id, employee_id, contract_type, start_date, basic_salary, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
    [req.user.company_id, employee.rows[0].id, payload.contract_type || "probation", payload.hire_date, Number(payload.basic_salary || 0), req.user.id],
  );

  await pool.query(
    `UPDATE erp_candidates SET status = 'onboarded', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
    [payload.candidate_id, req.user.company_id],
  );

  return res.status(201).json(employee.rows[0]);
});

router.get("/holidays", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM erp_holidays WHERE company_id = $1 AND is_deleted = FALSE ORDER BY holiday_date",
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/attendance/import", requirePermission("hr.create"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "rows array required" });

  let imported = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO erp_attendance (company_id, employee_id, attendance_date, check_in, check_out, hours_worked, overtime_hours, status, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'import',$9)
       ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
         hours_worked = EXCLUDED.hours_worked, overtime_hours = EXCLUDED.overtime_hours, updated_at = NOW()`,
      [
        req.user.company_id,
        row.employee_id,
        row.attendance_date,
        row.check_in,
        row.check_out,
        row.hours_worked || 8,
        row.overtime_hours || 0,
        row.status || "present",
        req.user.id,
      ],
    );
    imported += 1;
  }
  return res.json({ ok: true, imported });
});

module.exports = router;
