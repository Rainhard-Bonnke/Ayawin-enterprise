const crypto = require('crypto');
const { authenticator } = require('otplib');
const pool = require('../db');

const MFA_CIPHER_KEY = process.env.MFA_ENCRYPTION_KEY
  || crypto.createHash('sha256').update(process.env.JWT_SECRET || 'ayawin-enterprise-secret').digest();

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MFA_CIPHER_KEY.slice(0, 32), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', MFA_CIPHER_KEY.slice(0, 32), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function generateMfaSecret() {
  return authenticator.generateSecret();
}

function verifyTotp(secret, token) {
  return authenticator.verify({ token, secret });
}

function getOtpAuthUrl({ secret, email, issuer = 'Martin ERP' }) {
  return authenticator.keyuri(email, issuer, secret);
}

async function enableMfaPending(userId, companyId, secret) {
  await pool.query(
    `INSERT INTO erp_user_mfa (company_id, user_id, secret_encrypted, created_by)
     VALUES ($1, $2, $3, $2)
     ON CONFLICT (user_id) DO UPDATE
     SET secret_encrypted = EXCLUDED.secret_encrypted,
         verified_at = NULL,
         updated_at = NOW()`,
    [companyId, userId, encryptSecret(secret)],
  );
}

async function confirmMfa(userId, companyId) {
  await pool.query(
    `UPDATE erp_user_mfa SET verified_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND company_id = $2`,
    [userId, companyId],
  );
  await pool.query(
    `UPDATE erp_users SET mfa_enabled = TRUE, updated_at = NOW() WHERE id = $1`,
    [userId],
  );
}

async function getMfaRecord(userId) {
  const result = await pool.query(
    'SELECT secret_encrypted, verified_at FROM erp_user_mfa WHERE user_id = $1',
    [userId],
  );
  return result.rows[0] || null;
}

async function getDecryptedSecret(userId) {
  const row = await getMfaRecord(userId);
  if (!row?.secret_encrypted) return null;
  return decryptSecret(row.secret_encrypted);
}

module.exports = {
  generateMfaSecret,
  verifyTotp,
  getOtpAuthUrl,
  enableMfaPending,
  confirmMfa,
  getMfaRecord,
  getDecryptedSecret,
};
