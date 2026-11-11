const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const { logAudit } = require("../../services/auditService");
const { normalizeEmployeePii, decryptEmployeeValue } = require("../../lib/employeePii");

const router = express.Router();
router.use(authenticateErp);

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

      await client.query(
        `UPDATE erp_leave_applications SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
        [req.params.id, req.user.company_id, req.user.id],
      );

      await client.query(
        `UPDATE erp_leave_balances SET balance_days = balance_days - $3, updated_at = NOW()
       WHERE employee_id = $1 AND leave_type_id = $2`,
        [app.rows[0].employee_id, app.rows[0].leave_type_id, app.rows[0].days_requested],
      );

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
