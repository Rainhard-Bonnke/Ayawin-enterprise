const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const payroll = require('../../services/payrollService');

const router = express.Router();
router.use(authenticateErp);

router.get('/config', requirePermission('hr.view'), async (req, res) => {
  const config = await payroll.getPayrollConfig(req.user.company_id);
  return res.json(config);
});

router.get('/runs', requirePermission('hr.view'), async (req, res) => {
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

router.post('/runs', requirePermission('hr.create'), async (req, res) => {
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

router.get('/runs/:id/payslips', requirePermission('hr.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT ps.*, e.employee_code, e.first_name, e.last_name, e.bank_account_no
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     WHERE ps.payroll_run_id = $1 AND ps.company_id = $2
     ORDER BY e.last_name`,
    [req.params.id, req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/runs/:id/payslips/:payslipId', requirePermission('hr.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT ps.*, e.employee_code, e.first_name, e.last_name, e.email, e.department, e.job_title
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     WHERE ps.id = $1 AND ps.payroll_run_id = $2 AND ps.company_id = $3`,
    [req.params.payslipId, req.params.id, req.user.company_id],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Not found' });
  return res.json(result.rows[0]);
});

router.post('/runs/:id/post', requirePermission('hr.approve'), async (req, res) => {
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

router.get('/runs/:id/statutory-report', requirePermission('hr.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT SUM(paye) AS total_paye, SUM(nhif) AS total_nhif, SUM(nssf) AS total_nssf,
            SUM(housing_levy) AS total_housing, COUNT(*)::int AS employees
     FROM erp_payslips WHERE payroll_run_id = $1 AND company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  return res.json(result.rows[0]);
});

router.post('/preview', requirePermission('hr.view'), async (req, res) => {
  const { employee_id, extras } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id required' });

  const emp = await pool.query(
    `SELECT e.*, ec.basic_salary, ec.house_allowance, ec.transport_allowance
     FROM erp_employees e
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE e.id = $1 AND e.company_id = $2`,
    [employee_id, req.user.company_id],
  );
  if (!emp.rowCount) return res.status(404).json({ error: 'Employee not found' });

  const config = await payroll.getPayrollConfig(req.user.company_id);
  const slip = payroll.computePayslip(emp.rows[0], emp.rows[0], config, extras || {});
  return res.json(slip);
});

module.exports = router;
