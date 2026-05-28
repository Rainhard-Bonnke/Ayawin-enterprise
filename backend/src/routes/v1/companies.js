const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission, getClientIp } = require('../../middleware/erpAuth');
const { logAudit } = require('../../services/auditService');

const router = express.Router();

router.use(authenticateErp);

router.get('/', requirePermission('foundation.view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, name, legal_name, tax_registration_no, logo_url,
              base_currency_code, fiscal_year_start_month, default_language_code,
              timezone, is_active, created_at, updated_at
       FROM erp_companies
       WHERE is_deleted = FALSE
         AND (id = $1 OR EXISTS (
           SELECT 1 FROM erp_user_company_access a
           WHERE a.user_id = $2 AND a.granted_company_id = erp_companies.id AND a.is_deleted = FALSE
         ))
       ORDER BY name`,
      [req.user.company_id, req.user.id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/current', requirePermission('foundation.view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM erp_companies WHERE id = $1 AND is_deleted = FALSE`,
      [req.user.company_id],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Company not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/current', requirePermission('foundation.edit'), async (req, res) => {
  const allowed = ['name', 'legal_name', 'tax_registration_no', 'logo_url', 'base_currency_code', 'fiscal_year_start_month', 'default_language_code', 'timezone'];
  const updates = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
  const values = Object.values(updates);

  try {
    const before = await pool.query('SELECT * FROM erp_companies WHERE id = $1', [req.user.company_id]);
    const result = await pool.query(
      `UPDATE erp_companies SET ${sets.join(', ')}, updated_at = NOW(), updated_by = $${values.length + 2}
       WHERE id = $1 AND is_deleted = FALSE RETURNING *`,
      [req.user.company_id, ...values, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_companies',
      entityId: req.user.company_id,
      action: 'update',
      oldValues: before.rows[0],
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to update company' });
  }
});

router.get('/branches', requirePermission('foundation.view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM erp_branches
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY is_head_office DESC, name`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.post('/branches', requirePermission('foundation.edit'), async (req, res) => {
  const { code, name, address_line1, city, country_code, phone, email, is_head_office } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });

  try {
    const result = await pool.query(
      `INSERT INTO erp_branches (
         company_id, code, name, address_line1, city, country_code, phone, email, is_head_office, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,FALSE),$10)
       RETURNING *`,
      [req.user.company_id, code, name, address_line1, city, country_code || 'KE', phone, email, is_head_office, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_branches',
      entityId: result.rows[0].id,
      action: 'create',
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to create branch' });
  }
});

module.exports = router;
