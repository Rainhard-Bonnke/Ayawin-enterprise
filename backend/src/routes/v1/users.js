const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const userService = require('../../services/userService');
const { logAudit } = require('../../services/auditService');
const { getClientIp } = require('../../middleware/erpAuth');

const router = express.Router();
router.use(authenticateErp);

router.get('/', requirePermission('users.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.status, u.locale,
            u.mfa_enabled, u.last_login_at, r.name AS role_name, b.name AS branch_name
     FROM erp_users u
     LEFT JOIN erp_roles r ON r.id = u.role_id
     LEFT JOIN erp_branches b ON b.id = u.default_branch_id
     WHERE u.company_id = $1 AND u.is_deleted = FALSE
       AND ($2 = '' OR u.full_name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
     ORDER BY u.full_name`,
    [req.user.company_id, q],
  );
  return res.json(result.rows);
});

router.post('/', requirePermission('users.create'), async (req, res) => {
  const {
    username, email, full_name, phone, role_id, default_branch_id, password, locale,
  } = req.body || {};
  if (!username || !email || !full_name || !password) {
    return res.status(400).json({ error: 'username, email, full_name, password required' });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      `INSERT INTO erp_users (
         company_id, default_branch_id, role_id, username, email, full_name, phone,
         password_hash, locale, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'en'),$10)
       RETURNING id, username, email, full_name, phone, status, locale, role_id, default_branch_id`,
      [req.user.company_id, default_branch_id, role_id, username, email.toLowerCase(), full_name, phone, hash, locale, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_users',
      entityId: result.rows[0].id,
      action: 'create',
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to create user' });
  }
});

router.get('/:id', requirePermission('users.view'), async (req, res) => {
  const user = await userService.findUserById(req.params.id);
  if (!user || user.company_id !== req.user.company_id) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json(userService.sanitizeUser(user));
});

router.patch('/:id', requirePermission('users.edit'), async (req, res) => {
  const { full_name, phone, role_id, default_branch_id, status } = req.body || {};
  try {
    const before = await pool.query(
      'SELECT * FROM erp_users WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id],
    );
    if (!before.rowCount) return res.status(404).json({ error: 'User not found' });

    const result = await pool.query(
      `UPDATE erp_users SET
         full_name = COALESCE($3, full_name),
         phone = COALESCE($4, phone),
         role_id = COALESCE($5, role_id),
         default_branch_id = COALESCE($6, default_branch_id),
         status = COALESCE($7, status),
         updated_at = NOW(), updated_by = $8
       WHERE id = $1 AND company_id = $2
       RETURNING id, username, email, full_name, phone, status, role_id, default_branch_id`,
      [req.params.id, req.user.company_id, full_name, phone, role_id, default_branch_id, status, req.user.id],
    );

    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_users',
      entityId: req.params.id,
      action: 'update',
      oldValues: before.rows[0],
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to update user' });
  }
});

module.exports = router;
