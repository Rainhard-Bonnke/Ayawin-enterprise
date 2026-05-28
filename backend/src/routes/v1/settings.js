const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const { logAudit } = require('../../services/auditService');
const { getClientIp } = require('../../middleware/erpAuth');

const router = express.Router();
router.use(authenticateErp);

router.get('/', requirePermission('foundation.view'), async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  const params = [req.user.company_id];
  let filter = '';
  if (category) {
    filter = 'AND category = $2';
    params.push(category);
  }
  const result = await pool.query(
    `SELECT * FROM erp_system_settings
     WHERE company_id = $1 AND is_deleted = FALSE ${filter}
     ORDER BY category, setting_key`,
    params,
  );
  return res.json(result.rows);
});

router.put('/:category/:key', requirePermission('foundation.edit'), async (req, res) => {
  const { category, key } = req.params;
  const { setting_value, description } = req.body || {};
  if (setting_value === undefined) {
    return res.status(400).json({ error: 'setting_value is required' });
  }

  try {
    const before = await pool.query(
      `SELECT * FROM erp_system_settings
       WHERE company_id = $1 AND category = $2 AND setting_key = $3`,
      [req.user.company_id, category, key],
    );

    const result = await pool.query(
      `INSERT INTO erp_system_settings (company_id, category, setting_key, setting_value, description, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (company_id, category, setting_key) DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         description = COALESCE(EXCLUDED.description, erp_system_settings.description),
         updated_at = NOW(), updated_by = $6
       RETURNING *`,
      [req.user.company_id, category, key, JSON.stringify(setting_value), description, req.user.id],
    );

    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_system_settings',
      entityId: `${category}.${key}`,
      action: before.rowCount ? 'update' : 'create',
      oldValues: before.rows[0] || null,
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to save setting' });
  }
});

module.exports = router;
