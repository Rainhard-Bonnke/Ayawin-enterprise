const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const { logAudit } = require('../../services/auditService');
const { getClientIp } = require('../../middleware/erpAuth');

const router = express.Router();
router.use(authenticateErp);

router.get('/permissions', requirePermission('roles.view'), async (req, res) => {
  const result = await pool.query('SELECT * FROM erp_permissions ORDER BY module, action');
  return res.json(result.rows);
});

router.get('/', requirePermission('roles.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT r.*, COALESCE(json_agg(p.code) FILTER (WHERE p.id IS NOT NULL), '[]') AS permissions
     FROM erp_roles r
     LEFT JOIN erp_role_permissions rp ON rp.role_id = r.id AND rp.is_deleted = FALSE
     LEFT JOIN erp_permissions p ON p.id = rp.permission_id
     WHERE r.company_id = $1 AND r.is_deleted = FALSE
     GROUP BY r.id
     ORDER BY r.name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/', requirePermission('roles.create'), async (req, res) => {
  const { name, description, permission_codes = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roleResult = await client.query(
      `INSERT INTO erp_roles (company_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.company_id, name, description, req.user.id],
    );
    const role = roleResult.rows[0];

    if (permission_codes.length) {
      await client.query(
        `INSERT INTO erp_role_permissions (company_id, role_id, permission_id, created_by)
         SELECT $1, $2, p.id, $4 FROM erp_permissions p WHERE p.code = ANY($3::text[])`,
        [req.user.company_id, role.id, permission_codes, req.user.id],
      );
    }

    await client.query('COMMIT');
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_roles',
      entityId: role.id,
      action: 'create',
      newValues: role,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(role);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Unable to create role' });
  } finally {
    client.release();
  }
});

router.put('/:id/permissions', requirePermission('roles.edit'), async (req, res) => {
  const { permission_codes = [] } = req.body || {};
  const roleId = req.params.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE erp_role_permissions SET is_deleted = TRUE, updated_at = NOW()
       WHERE role_id = $1 AND company_id = $2`,
      [roleId, req.user.company_id],
    );
    if (permission_codes.length) {
      await client.query(
        `INSERT INTO erp_role_permissions (company_id, role_id, permission_id, created_by)
         SELECT $1, $2, p.id, $4 FROM erp_permissions p WHERE p.code = ANY($3::text[])
         ON CONFLICT (role_id, permission_id) DO UPDATE SET is_deleted = FALSE, updated_at = NOW()`,
        [req.user.company_id, roleId, permission_codes, req.user.id],
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Unable to update permissions' });
  } finally {
    client.release();
  }
});

module.exports = router;
