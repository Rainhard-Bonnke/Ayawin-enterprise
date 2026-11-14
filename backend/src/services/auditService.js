const crypto = require("node:crypto");
const pool = require("../db");

function assertDifferentUser(createdBy, actor) {
  if (createdBy && actor && String(createdBy) === String(actor)) {
    throw new Error("The document creator cannot approve their own document");
  }
}

function normalizeAuditJson(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

function buildAuditHashChain(rows = []) {
  let previousHash = "GENESIS";
  return rows
    .slice()
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .map((row) => {
      const entityType = row.entity_type || "unknown";
      const entityId = row.entity_id == null ? "" : String(row.entity_id);
      const action = row.action || "unknown_action";
      const createdAt = row.created_at || "";
      const payload = normalizeAuditJson(row.new_values ?? row.old_values ?? null) || "{}";
      const hashSource = `${previousHash}|${row.id}|${entityType}|${entityId}|${action}|${createdAt}|${payload}`;
      const hash = crypto.createHash("sha256").update(hashSource).digest("hex");
      const entry = {
        id: row.id,
        company_id: row.company_id ?? null,
        user_id: row.user_id ?? null,
        entity_type: entityType,
        entity_id: entityId,
        action,
        created_at: createdAt,
        old_values: row.old_values ?? null,
        new_values: row.new_values ?? null,
        previous_hash: previousHash,
        hash,
      };
      previousHash = hash;
      return entry;
    });
}

function hashChainCsvRows(rows = []) {
  if (!rows.length) {
    return [
      "sequence,entity_type,entity_id,action,created_at,previous_hash,hash",
    ].join("\n");
  }

  const header = ["sequence", "entity_type", "entity_id", "action", "created_at", "previous_hash", "hash", "id"];
  const lines = rows.map((row, index) => {
    const values = [
      String(index + 1),
      row.entity_type || "",
      row.entity_id || "",
      row.action || "",
      row.created_at || "",
      row.previous_hash || "",
      row.hash || "",
      row.id || "",
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    return values.join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

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

async function listAuditLogs({ companyId, q = "", limit = 50, offset = 0, entityType = null, entityId = null }) {
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
       AND ($3::text IS NULL OR a.entity_type = $3)
       AND ($4::text IS NULL OR a.entity_id = $4)
     ORDER BY a.created_at DESC
     LIMIT $5 OFFSET $6`,
    [companyId, q.trim(), entityType, entityId, safeLimit, safeOffset],
  );

  return result.rows;
}

module.exports = {
  logAudit,
  listAuditLogs,
  assertDifferentUser,
  buildAuditHashChain,
  hashChainCsvRows,
};
