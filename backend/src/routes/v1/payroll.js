const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const payroll = require("../../services/payrollService");
const remittances = require("../../services/payrollRemittanceService");
const { logAudit } = require("../../services/auditService");

const router = express.Router();
router.use(authenticateErp);

router.get("/config", requirePermission("hr.view"), async (req, res) => {
  const config = await payroll.getPayrollConfig(req.user.company_id, req.query.payroll_month);
  return res.json(config);
});

router.get("/runs", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT pr.*, COUNT(ps.id)::int AS employee_count
     FROM erp_payroll_runs pr
     LEFT JOIN erp_payslips ps ON ps.payroll_run_id = pr.id
     WHERE pr.company_id = $1 AND pr.is_deleted = FALSE
     GROUP BY pr.id ORDER BY pr.payroll_month DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/runs", requirePermission("hr.create"), async (req, res) => {
  try {
    const result = await payroll.runPayroll({
      companyId: req.user.company_id,
      userId: req.user.id,
      payrollMonth: req.body.payroll_month,
      employeeExtras: req.body.employee_extras || {},
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/runs/:id/approve", requirePermission("hr.approve"), async (req, res) => {
  try {
    return res.json(await payroll.approvePayrollRun({
      companyId: req.user.company_id,
      userId: req.user.id,
      runId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/runs/:id/lock", requirePermission("hr.approve"), async (req, res) => {
  try {
    return res.json(await payroll.lockPayrollRun({
      companyId: req.user.company_id,
      userId: req.user.id,
      runId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/runs/:id/payslips", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT ps.*, e.employee_code, e.first_name, e.last_name
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     WHERE ps.payroll_run_id = $1 AND ps.company_id = $2
     ORDER BY e.last_name`,
    [req.params.id, req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/runs/:id/payslips/:payslipId", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT ps.*, e.employee_code, e.first_name, e.last_name, e.email, e.department, e.job_title
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     WHERE ps.id = $1 AND ps.payroll_run_id = $2 AND ps.company_id = $3`,
    [req.params.payslipId, req.params.id, req.user.company_id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Not found" });
  return res.json(result.rows[0]);
});

router.post("/runs/:id/post", requirePermission("hr.approve"), async (req, res) => {
  try {
    const result = await payroll.postPayrollToGl({
      companyId: req.user.company_id,
      userId: req.user.id,
      runId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/runs/:id/release", requirePermission("hr.approve"), async (req, res) => {
  try {
    return res.json(await payroll.releasePayrollRun({
      companyId: req.user.company_id,
      userId: req.user.id,
      runId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/runs/:id/payment-file.csv", requirePermission("hr.export"), async (req, res) => {
  const result = await pool.query(
    `SELECT pr.run_no,pr.status,e.employee_code,e.first_name,e.last_name,e.bank_name,e.bank_account_no,ps.net_pay
     FROM erp_payroll_runs pr
     JOIN erp_payslips ps ON ps.payroll_run_id=pr.id AND ps.company_id=pr.company_id
     JOIN erp_employees e ON e.id=ps.employee_id AND e.company_id=pr.company_id
     WHERE pr.id=$1 AND pr.company_id=$2 AND pr.is_deleted=FALSE
     ORDER BY e.employee_code`,
    [req.params.id, req.user.company_id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Payroll run has no payslips" });
  if (result.rows[0].status !== "released") return res.status(409).json({ error: "Payroll must be released before exporting its payment file" });
  const missingBank = result.rows.filter((row) => !row.bank_account_no);
  if (missingBank.length) {
    return res.status(409).json({ error: `${missingBank.length} employees are missing bank account details` });
  }

  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_payroll_runs",
    entityId: req.params.id,
    action: "payroll_bank_payment_file_exported",
    newValues: { run_no: result.rows[0].run_no, employee_count: result.rowCount },
    ipAddress: req.clientIp,
    userAgent: req.headers["user-agent"],
  });
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    ["employee_code", "employee_name", "bank_name", "bank_account_no", "amount_kes", "reference"].map(quote).join(","),
    ...result.rows.map((row) => [
      row.employee_code,
      `${row.first_name} ${row.last_name}`.trim(),
      row.bank_name,
      row.bank_account_no,
      Number(row.net_pay).toFixed(2),
      row.run_no,
    ].map(quote).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${result.rows[0].run_no}-bank-payments.csv"`);
  return res.send(lines.join("\r\n"));
});

router.get("/runs/:id/statutory-report", requirePermission("hr.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT SUM(paye) AS total_paye, SUM(shif) AS total_shif, SUM(nhif) AS total_legacy_nhif,
            SUM(nssf) AS total_nssf_employee, SUM(nssf_employer) AS total_nssf_employer,
            SUM(housing_levy) AS total_housing_employee,
            SUM(housing_levy_employer) AS total_housing_employer,
            SUM(employer_cost) AS total_employer_cost, COUNT(*)::int AS employees
     FROM erp_payslips WHERE payroll_run_id = $1 AND company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  return res.json(result.rows[0]);
});

router.get("/statutory-remittances", requirePermission("hr.view"), async (req, res) => {
  try {
    return res.json(await remittances.listRemittances(req.user.company_id, req.query.payroll_run_id || null));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/statutory-remittances/:id/payments", requirePermission("hr.create"), async (req, res) => {
  try {
    const payment = await remittances.createPayment({
      companyId: req.user.company_id,
      userId: req.user.id,
      remittanceId: req.params.id,
      amount: req.body?.amount,
      paymentDate: req.body?.payment_date,
      bankAccountId: req.body?.bank_account_id,
      referenceNo: req.body?.reference_no,
    });
    return res.status(201).json(payment);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/statutory-remittance-payments/:id/post", requirePermission("hr.approve"), async (req, res) => {
  try {
    return res.json(await remittances.postPayment({
      companyId: req.user.company_id,
      userId: req.user.id,
      paymentId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/preview", requirePermission("hr.view"), async (req, res) => {
  const { employee_id, extras } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: "employee_id required" });

  const emp = await pool.query(
    `SELECT e.*, ec.basic_salary, ec.house_allowance, ec.transport_allowance
     FROM erp_employees e
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE e.id = $1 AND e.company_id = $2`,
    [employee_id, req.user.company_id],
  );
  if (!emp.rowCount) return res.status(404).json({ error: "Employee not found" });

  const config = await payroll.getPayrollConfig(req.user.company_id, req.body?.payroll_month);
  const slip = payroll.computePayslip(emp.rows[0], emp.rows[0], config, extras || {});
  return res.json(slip);
});

module.exports = router;
