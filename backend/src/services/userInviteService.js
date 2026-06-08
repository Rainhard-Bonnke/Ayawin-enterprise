const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { BCRYPT_ROUNDS } = require('../constants');
const { logAudit } = require('./auditService');
const integration = require('./integrationService');
const passwordResetService = require('./passwordResetService');

async function inviteUser({
  companyId,
  invitedBy,
  email,
  full_name,
  username,
  role_id,
  phone,
  default_branch_id,
}) {
  const normalizedEmail = email.trim().toLowerCase();
  const uname = username?.trim() || normalizedEmail.split('@')[0];

  const existing = await pool.query(
    `SELECT id FROM erp_users WHERE company_id = $1 AND LOWER(email) = $2 AND is_deleted = FALSE`,
    [companyId, normalizedEmail],
  );
  if (existing.rowCount) {
    const err = new Error('A user with this email already exists');
    err.code = 'DUPLICATE_EMAIL';
    throw err;
  }

  const placeholder = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO erp_users (
       company_id, default_branch_id, role_id, username, email, full_name, phone,
       password_hash, status, locale, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','en',$9)
     RETURNING id, username, email, full_name, status, role_id`,
    [companyId, default_branch_id, role_id, uname, normalizedEmail, full_name, phone, placeholder, invitedBy],
  );
  const user = result.rows[0];

  const reset = await passwordResetService.requestPasswordReset(normalizedEmail, {
    subject: 'You are invited to Ayawin ERP',
    intro: `Hello ${full_name},\n\nYou have been invited to Ayawin ERP. Set your password using this secure link:`,
  });

  await logAudit({
    companyId,
    userId: invitedBy,
    entityType: 'erp_users',
    entityId: user.id,
    action: 'user_invited',
    newValues: { email: normalizedEmail, role_id },
  });

  return { user, dev_token: reset.dev_token };
}

module.exports = { inviteUser };
