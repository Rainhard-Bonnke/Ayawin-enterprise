const pool = require('../db');

async function logAudit({
  companyId,
  userId,
  entityType,
  entityId,
  action,
  oldValues = null,
  newValues = null,
  ipAddress = null,
  userAgent = null,
  client = pool,
}) {
  if (!companyId || !entityType || !action) return;

  await client.query(
    `INSERT INTO erp_audit_log (
       company_id, user_id, entity_type, entity_id, action,
       old_values, new_values, ip_address, user_agent
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      companyId,
      userId || null,
      entityType,
      entityId ? String(entityId) : null,
      action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent,
    ],
  );
}

async function listAuditLogs({ companyId, q = '', limit = 50, offset = 0 }) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);

  const result = await pool.query(
    `SELECT a.id, a.user_id, a.entity_type, a.entity_id, a.action,
            a.old_values, a.new_values, a.ip_address, a.user_agent, a.created_at,
            u.full_name AS user_name, u.email AS user_email
     FROM erp_audit_log a
     LEFT JOIN erp_users u ON u.id = a.user_id
     WHERE a.company_id = $1
       AND ($2 = '' OR a.action ILIKE '%' || $2 || '%'
            OR a.entity_type ILIKE '%' || $2 || '%'
            OR COALESCE(a.entity_id, '') ILIKE '%' || $2 || '%')
     ORDER BY a.created_at DESC
     LIMIT $3 OFFSET $4`,
    [companyId, q.trim(), safeLimit, safeOffset],
  );

  return result.rows;
}

module.exports = { logAudit, listAuditLogs };
