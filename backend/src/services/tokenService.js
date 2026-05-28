const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'ayawin-enterprise-secret';
const JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const JWT_REFRESH_EXPIRES_DAYS = Number(process.env.JWT_REFRESH_EXPIRES_DAYS) || 7;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      companyId: user.company_id,
      branchId: user.default_branch_id,
      roleId: user.role_id,
      email: user.email,
      permissions: user.permissions || [],
      type: 'access',
    },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES },
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

async function storeRefreshToken({ user, token, ipAddress, deviceInfo, client = pool }) {
  const tokenHash = hashToken(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRES_DAYS);

  const result = await client.query(
    `INSERT INTO erp_refresh_tokens (
       company_id, user_id, token_hash, expires_at, ip_address, device_info, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $2)
     RETURNING id, expires_at`,
    [user.company_id, user.id, tokenHash, expiresAt, ipAddress, deviceInfo],
  );

  return result.rows[0];
}

async function revokeRefreshToken(tokenHash, replacedBy = null) {
  await pool.query(
    `UPDATE erp_refresh_tokens
     SET revoked_at = NOW(), replaced_by = $2, updated_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash, replacedBy],
  );
}

async function findValidRefreshToken(token) {
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `SELECT rt.id AS token_id, rt.expires_at, rt.revoked_at,
            u.id, u.company_id, u.default_branch_id, u.role_id, u.email, u.full_name, u.username, u.status
     FROM erp_refresh_tokens rt
     JOIN erp_users u ON u.id = rt.user_id AND u.is_deleted = FALSE
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  hashToken,
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  revokeRefreshToken,
  findValidRefreshToken,
  verifyAccessToken,
  JWT_SECRET,
};
