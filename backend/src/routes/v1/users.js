const express = require("express");
const bcrypt = require("bcryptjs");
const ipaddr = require("ipaddr.js");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const userService = require("../../services/userService");
const { logAudit } = require("../../services/auditService");
const { getClientIp } = require("../../middleware/erpAuth");

const router = express.Router();
router.use(authenticateErp);

router.get("/", requirePermission("users.view"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
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

router.post("/", requirePermission("users.create"), async (req, res) => {
  const { username, email, full_name, phone, role_id, default_branch_id, password, locale } =
    req.body || {};
  if (!username || !email || !full_name || !password) {
    return res.status(400).json({ error: "username, email, full_name, password required" });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO erp_users (
         company_id, default_branch_id, role_id, username, email, full_name, phone,
         password_hash, locale, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'en'),$10)
       RETURNING id, username, email, full_name, phone, status, locale, role_id, default_branch_id`,
      [
        req.user.company_id,
        default_branch_id,
        role_id,
        username,
        email.toLowerCase(),
        full_name,
        phone,
        hash,
        locale,
        req.user.id,
      ],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_users",
      entityId: result.rows[0].id,
      action: "create",
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to create user" });
  }
});

router.get("/security/ip-whitelist", requirePermission("users.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT w.id, w.cidr, w.description, w.user_id, w.role_id, w.created_at,
            u.full_name AS user_name, u.email AS user_email,
            r.name AS role_name
     FROM erp_ip_whitelist w
     LEFT JOIN erp_users u ON u.id = w.user_id AND u.is_deleted = FALSE
     LEFT JOIN erp_roles r ON r.id = w.role_id AND r.is_deleted = FALSE
     WHERE w.company_id = $1 AND w.is_deleted = FALSE
     ORDER BY w.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/security/ip-whitelist", requirePermission("users.edit"), async (req, res) => {
  const cidr = typeof req.body?.cidr === "string" ? req.body.cidr.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const userId = typeof req.body?.user_id === "string" ? req.body.user_id : null;
  const roleId = typeof req.body?.role_id === "string" ? req.body.role_id : null;

  if (!cidr) return res.status(400).json({ error: "cidr is required" });
  if (!userId && !roleId) return res.status(400).json({ error: "user_id or role_id is required" });

  try {
    ipaddr.parseCIDR(cidr);
  } catch {
    return res.status(400).json({ error: "cidr must be a valid CIDR range" });
  }

  if (userId) {
    const user = await pool.query(
      "SELECT id FROM erp_users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE",
      [userId, req.user.company_id],
    );
    if (!user.rowCount) {
      return res.status(400).json({ error: "User not found in this company" });
    }
  }

  if (roleId) {
    const role = await pool.query(
      "SELECT id FROM erp_roles WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE",
      [roleId, req.user.company_id],
    );
    if (!role.rowCount) {
      return res.status(400).json({ error: "Role not found in this company" });
    }
  }

  const result = await pool.query(
    `INSERT INTO erp_ip_whitelist (company_id, user_id, role_id, cidr, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [req.user.company_id, userId, roleId, cidr, description || null, req.user.id],
  );

  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_ip_whitelist",
    entityId: result.rows[0].id,
    action: "ip_whitelist_created",
    newValues: { cidr, description, scope: userId ? `user:${userId}` : `role:${roleId}` },
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  return res.status(201).json(result.rows[0]);
});

router.delete("/security/ip-whitelist/:id", requirePermission("users.edit"), async (req, res) => {
  const result = await pool.query(
    `UPDATE erp_ip_whitelist
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
     RETURNING id, cidr`,
    [req.params.id, req.user.company_id, req.user.id],
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: "IP allowlist rule not found" });
  }

  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_ip_whitelist",
    entityId: result.rows[0].id,
    action: "ip_whitelist_removed",
    oldValues: { cidr: result.rows[0].cidr },
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  return res.json({ ok: true });
});

router.get("/security/sessions", requirePermission("users.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT rt.id, rt.user_id, rt.session_type, rt.device_info, rt.ip_address, rt.created_at, rt.expires_at,
            u.full_name, u.email, u.username
     FROM erp_refresh_tokens rt
     JOIN erp_users u ON u.id = rt.user_id AND u.is_deleted = FALSE
     WHERE rt.company_id = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
     ORDER BY rt.created_at DESC
     LIMIT 200`,
    [req.user.company_id],
  );

  return res.json(result.rows);
});

router.post("/security/sessions/:id/revoke", requirePermission("users.edit"), async (req, res) => {
  const result = await pool.query(
    `UPDATE erp_refresh_tokens
     SET revoked_at = NOW(), updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND revoked_at IS NULL
     RETURNING id, user_id`,
    [req.params.id, req.user.company_id, req.user.id],
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: "Session not found" });
  }

  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_refresh_tokens",
    entityId: result.rows[0].id,
    action: "session_revoked",
    newValues: { user_id: result.rows[0].user_id },
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  return res.json({ ok: true });
});

router.get("/:id", requirePermission("users.view"), async (req, res) => {
  const user = await userService.findUserById(req.params.id);
  if (!user || user.company_id !== req.user.company_id) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json(userService.sanitizeUser(user));
});

router.patch("/:id", requirePermission("users.edit"), async (req, res) => {
  const { full_name, phone, role_id, default_branch_id, status } = req.body || {};
  try {
    const before = await pool.query("SELECT * FROM erp_users WHERE id = $1 AND company_id = $2", [
      req.params.id,
      req.user.company_id,
    ]);
    if (!before.rowCount) return res.status(404).json({ error: "User not found" });

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
      [
        req.params.id,
        req.user.company_id,
        full_name,
        phone,
        role_id,
        default_branch_id,
        status,
        req.user.id,
      ],
    );

    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_users",
      entityId: req.params.id,
      action: "update",
      oldValues: before.rows[0],
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    await userService.invalidateUserCache(req.params.id);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to update user" });
  }
});

module.exports = router;
