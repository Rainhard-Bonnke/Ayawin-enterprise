const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const { parsePagination } = require('../../lib/queryHelper');

const router = express.Router();
router.use(authenticateErp);

router.get('/leads', requirePermission('sales.view'), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const [countR, dataR] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM erp_leads WHERE company_id = $1 AND is_deleted = FALSE', [req.user.company_id]),
    pool.query(
      `SELECT * FROM erp_leads WHERE company_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.company_id, limit, offset],
    ),
  ]);
  return res.json({ data: dataR.rows, pagination: { page, limit, total: countR.rows[0].total } });
});

router.get('/opportunities', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT o.*, c.name AS customer_name FROM erp_opportunities o
     LEFT JOIN erp_customers c ON c.id = o.customer_id
     WHERE o.company_id = $1 AND o.is_deleted = FALSE ORDER BY o.amount DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/pipeline', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS total_amount,
            COALESCE(SUM(amount * probability / 100),0) AS weighted_forecast
     FROM erp_opportunities
     WHERE company_id = $1 AND is_deleted = FALSE AND stage NOT IN ('won','lost')
     GROUP BY stage ORDER BY stage`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/activities', requirePermission('sales.create'), async (req, res) => {
  const { lead_id, opportunity_id, customer_id, activity_type, subject, description, activity_date } = req.body || {};
  if (!activity_type || !subject) return res.status(400).json({ error: 'activity_type and subject required' });
  const result = await pool.query(
    `INSERT INTO erp_crm_activities (
       company_id, lead_id, opportunity_id, customer_id, activity_type, subject, description,
       activity_date, assigned_to, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,NOW()),$9,$9) RETURNING *`,
    [req.user.company_id, lead_id, opportunity_id, customer_id, activity_type, subject, description, activity_date, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

module.exports = router;
