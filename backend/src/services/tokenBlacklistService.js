const pool = require('../db');
const { cacheSet, cacheGet } = require('../lib/redis');

const memoryBlacklist = new Map();

function purgeMemory() {
  const now = Date.now();
  for (const [jti, exp] of memoryBlacklist.entries()) {
    if (exp <= now) memoryBlacklist.delete(jti);
  }
}

async function revokeAccessToken({ jti, userId, companyId, expiresAt }) {
  if (!jti) return;
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  memoryBlacklist.set(jti, exp.getTime());
  const ttlSec = Math.max(60, Math.ceil((exp.getTime() - Date.now()) / 1000));
  await cacheSet(`revoked:jti:${jti}`, true, ttlSec).catch(() => {});
  await pool.query(
    `INSERT INTO erp_revoked_access_tokens (jti, user_id, company_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, userId, companyId, exp],
  );
}

async function isAccessTokenRevoked(jti) {
  if (!jti) return false;
  purgeMemory();
  if (memoryBlacklist.has(jti) && memoryBlacklist.get(jti) > Date.now()) return true;

  const cached = await cacheGet(`revoked:jti:${jti}`);
  if (cached) return true;

  const result = await pool.query(
    `SELECT 1 FROM erp_revoked_access_tokens WHERE jti = $1 AND expires_at > NOW() LIMIT 1`,
    [jti],
  );
  return result.rowCount > 0;
}

module.exports = { revokeAccessToken, isAccessTokenRevoked };
