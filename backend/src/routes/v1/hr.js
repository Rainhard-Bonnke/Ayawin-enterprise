const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');

const router = express.Router();
router.use(authenticateErp);

router.get('/employees', requirePermission('hr.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const result = await pool.query(
    `SELECT e.*, b.name AS branch_name
     FROM erp_employees e
     LEFT JOIN erp_branches b ON b.id = e.branch_id
     WHERE e.company_id = $1 AND e.is_deleted = FALSE
       AND ($2 = '' OR e.first_name ILIKE '%' || $2 || '%' OR e.last_name ILIKE '%' || $2 || '%' OR e.employee_code ILIKE '%' || $2 || '%')
     ORDER BY e.last_name, e.first_name`,
    [req.user.company_id, q],
  );
  return res.json(result.rows);
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

router.post('/leave-applications', requirePermission('hr.create'), async (req, res) => {
  const { employee_id, leave_type_id, start_date, end_date, days_requested, reason } = req.body || {};
  if (!employee_id || !leave_type_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'employee_id, leave_type_id, start_date, end_date required' });
  }
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
});

router.post('/leave-applications/:id/approve', requirePermission('hr.approve'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const app = await client.query(
      `SELECT * FROM erp_leave_applications WHERE id = $1 AND company_id = $2 AND status = 'pending' FOR UPDATE`,
      [req.params.id, req.user.company_id],
    );
    if (!app.rowCount) throw new Error('Application not found');

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

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/holidays', requirePermission('hr.view'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM erp_holidays WHERE company_id = $1 AND is_deleted = FALSE ORDER BY holiday_date',
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/attendance/import', requirePermission('hr.create'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'rows array required' });

  let imported = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO erp_attendance (company_id, employee_id, attendance_date, check_in, check_out, hours_worked, overtime_hours, status, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'import',$9)
       ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
         hours_worked = EXCLUDED.hours_worked, overtime_hours = EXCLUDED.overtime_hours, updated_at = NOW()`,
      [req.user.company_id, row.employee_id, row.attendance_date, row.check_in, row.check_out, row.hours_worked || 8, row.overtime_hours || 0, row.status || 'present', req.user.id],
    );
    imported += 1;
  }
  return res.json({ ok: true, imported });
});

module.exports = router;
