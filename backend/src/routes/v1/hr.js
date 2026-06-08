const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const hr = require('../../services/hrService');

const router = express.Router();
router.use(authenticateErp);

router.get('/employees', requirePermission('hr.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await hr.listEmployeesWithCompleteness(req.user.company_id, q);
  return res.json(rows);
});

router.get('/org-chart', requirePermission('hr.view'), async (req, res) => {
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

router.get('/leave-types', requirePermission('hr.view'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM erp_leave_types WHERE company_id = $1 AND is_deleted = FALSE ORDER BY name',
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/leave-applications', requirePermission('hr.view'), async (req, res) => {
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

router.get('/leave-calendar', requirePermission('hr.view'), async (req, res) => {
  const calendar = await hr.getLeaveCalendar(
    req.user.company_id,
    req.query.from_date,
    req.query.to_date,
  );
  return res.json(calendar);
});

router.post('/leave-applications', requirePermission('hr.create'), async (req, res) => {
  const { employee_id, leave_type_id, start_date, end_date, days_requested, reason } = req.body || {};
  if (!employee_id || !leave_type_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'employee_id, leave_type_id, start_date, end_date required' });
  }
  try {
    await hr.assertEmployeeInCompany(req.user.company_id, employee_id);
    const countR = await pool.query('SELECT COUNT(*)::int AS n FROM erp_leave_applications WHERE company_id = $1', [req.user.company_id]);
    const applicationNo = `LA-${new Date().getFullYear()}-${String(Number(countR.rows[0].n) + 1).padStart(4, '0')}`;
    const result = await pool.query(
      `INSERT INTO erp_leave_applications (
         company_id, employee_id, leave_type_id, application_no, start_date, end_date,
         days_requested, reason, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),$8,$9) RETURNING *`,
      [req.user.company_id, employee_id, leave_type_id, applicationNo, start_date, end_date, days_requested, reason, req.user.id],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/leave-applications/:id/approve', requirePermission('hr.approve'), async (req, res) => {
  try {
    const result = await hr.approveLeaveApplication({
      companyId: req.user.company_id,
      userId: req.user.id,
      applicationId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/holidays', requirePermission('hr.view'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM erp_holidays WHERE company_id = $1 AND is_deleted = FALSE ORDER BY holiday_date',
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/attendance', requirePermission('hr.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const result = await pool.query(
    `SELECT a.*, e.first_name, e.last_name, e.department, e.job_title, e.employee_code
     FROM erp_attendance a
     JOIN erp_employees e ON e.id = a.employee_id AND e.company_id = a.company_id
     WHERE a.company_id = $1 AND a.is_deleted = FALSE
     ORDER BY a.attendance_date DESC, e.last_name
     LIMIT $2`,
    [req.user.company_id, limit],
  );
  return res.json(result.rows);
});

router.post('/attendance/import', requirePermission('hr.create'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  try {
    const result = await hr.importAttendance({
      companyId: req.user.company_id,
      userId: req.user.id,
      rows,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
