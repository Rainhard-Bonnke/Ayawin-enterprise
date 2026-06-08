const crypto = require('crypto');
const pool = require('../db');
const bcrypt = require('bcryptjs');
const { BCRYPT_ROUNDS, PASSWORD_RESET_HOURS } = require('../constants');
const { logAudit } = require('./auditService');
const integration = require('./integrationService');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function requestPasswordReset(email, options = {}) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized) return { ok: true };

  const userResult = await pool.query(
    `SELECT id, company_id, email, full_name, status
     FROM erp_users WHERE LOWER(email) = $1 AND is_deleted = FALSE LIMIT 1`,
    [normalized],
  );
  const user = userResult.rows[0];
  if (!user || user.status === 'inactive') {
    return { ok: true };
  }

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + PASSWORD_RESET_HOURS);

  await pool.query(
    `UPDATE erp_password_reset_tokens
     SET used_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [user.id],
  );

  await pool.query(
    `INSERT INTO erp_password_reset_tokens (company_id, user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $2)`,
    [user.company_id, user.id, tokenHash, expiresAt],
  );

  const appBase = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const resetLink = `${appBase}/login?reset=${encodeURIComponent(rawToken)}`;

  const subject = options.subject || 'Reset your Ayawin ERP password';
  const intro = options.intro
    || `Hello ${user.full_name || user.email},\n\nReset your password:`;
  await integration.sendNotification({
    companyId: user.company_id,
    channel: 'email',
    to: user.email,
    subject,
    body: `${intro} ${resetLink}\n\nThis link expires in ${PASSWORD_RESET_HOURS} hours.`,
  });

  await logAudit({
    companyId: user.company_id,
    userId: user.id,
    entityType: 'erp_users',
    entityId: user.id,
    action: 'password_reset_requested',
    newValues: { email: user.email },
  });

  return { ok: true, dev_token: process.env.NODE_ENV !== 'production' ? rawToken : undefined };
}

async function resetPasswordWithToken(token, newPassword) {
  const raw = typeof token === 'string' ? token.trim() : '';
  const password = typeof newPassword === 'string' ? newPassword : '';
  if (!raw || password.length < 8) {
    throw new Error('Valid token and password (min 8 characters) are required');
  }

  const tokenHash = hashToken(raw);
  const rowResult = await pool.query(
    `SELECT prt.*, u.email
     FROM erp_password_reset_tokens prt
     JOIN erp_users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > NOW()
       AND prt.is_deleted = FALSE
     LIMIT 1`,
    [tokenHash],
  );
  const row = rowResult.rows[0];
  if (!row) throw new Error('Invalid or expired reset link');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(
    `UPDATE erp_users
     SET password_hash = $1, password_changed_at = NOW(), failed_login_attempts = 0,
         locked_until = NULL, status = 'active', updated_at = NOW()
     WHERE id = $2`,
    [hash, row.user_id],
  );
  // Invited users activate on first password set

  await pool.query(
    `UPDATE erp_password_reset_tokens SET used_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [row.id],
  );

  await pool.query(
    `UPDATE erp_refresh_tokens SET revoked_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [row.user_id],
  );

  await logAudit({
    companyId: row.company_id,
    userId: row.user_id,
    entityType: 'erp_users',
    entityId: row.user_id,
    action: 'password_reset_completed',
  });

  return { ok: true };
}

module.exports = {
  requestPasswordReset,
  resetPasswordWithToken,
};
