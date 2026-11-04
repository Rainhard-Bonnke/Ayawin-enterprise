const crypto = require("crypto");
const { authenticator } = require("otplib");
const pool = require("../db");
const bcrypt = require("bcryptjs");

const MFA_CIPHER_KEY = crypto.createHash("sha256").update(process.env.MFA_ENCRYPTION_KEY || "").digest();

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MFA_CIPHER_KEY.slice(0, 32), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", MFA_CIPHER_KEY.slice(0, 32), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function generateMfaSecret() {
  return authenticator.generateSecret();
}

function verifyTotp(secret, token) {
  return authenticator.verify({ token, secret });
}

function getOtpAuthUrl({ secret, email, issuer = "Martin ERP" }) {
  return authenticator.keyuri(email, issuer, secret);
}

async function enableMfaPending(userId, companyId, secret) {
  await pool.query(
    `INSERT INTO erp_user_mfa (company_id, user_id, pending_secret_encrypted, created_by)
     VALUES ($1, $2, $3, $2)
     ON CONFLICT (user_id) DO UPDATE
     SET pending_secret_encrypted = EXCLUDED.pending_secret_encrypted,
         updated_at = NOW()`,
    [companyId, userId, encryptSecret(secret)],
  );
}

async function confirmMfa(userId, companyId) {
  const recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(6).toString("hex"));
  const recoveryHashes = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(code, 12)));
  await pool.query(
    `UPDATE erp_user_mfa SET secret_encrypted = pending_secret_encrypted,
       pending_secret_encrypted = NULL, verified_at = NOW(), last_used_step = floor(extract(epoch from NOW()) / 30)::bigint,
       backup_codes_hash = $3,
       updated_at = NOW()
     WHERE user_id = $1 AND company_id = $2`,
    [userId, companyId, recoveryHashes],
  );
  await pool.query(`UPDATE erp_users SET mfa_enabled = TRUE, updated_at = NOW() WHERE id = $1`, [
    userId,
  ]);
  return recoveryCodes;
}

async function consumeTotp(userId, secret, token) {
  const step = verifyTotpStep(secret, token);
  if (step === null) return false;
  const result = await pool.query(
    `UPDATE erp_user_mfa SET last_used_step = $2, updated_at = NOW()
     WHERE user_id = $1 AND verified_at IS NOT NULL AND COALESCE(last_used_step, -1) < $2`,
    [userId, step],
  );
  return result.rowCount === 1;
}

async function consumeRecoveryCode(userId, code) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT backup_codes_hash FROM erp_user_mfa WHERE user_id=$1 FOR UPDATE", [userId]);
    const hashes = result.rows[0]?.backup_codes_hash || [];
    let matchedIndex = -1;
    for (let index = 0; index < hashes.length; index += 1) {
      if (await bcrypt.compare(code, hashes[index])) { matchedIndex = index; break; }
    }
    if (matchedIndex < 0) { await client.query("ROLLBACK"); return false; }
    hashes.splice(matchedIndex, 1);
    await client.query("UPDATE erp_user_mfa SET backup_codes_hash=$2,updated_at=NOW() WHERE user_id=$1", [userId, hashes]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function getPendingSecret(userId) {
  const result = await pool.query(
    "SELECT pending_secret_encrypted FROM erp_user_mfa WHERE user_id = $1",
    [userId],
  );
  const encrypted = result.rows[0]?.pending_secret_encrypted;
  return encrypted ? decryptSecret(encrypted) : null;
}

function verifyTotpStep(secret, token, afterStep = -1) {
  const current = Math.floor(Date.now() / 30000);
  for (let step = current - 1; step <= current + 1; step += 1) {
    if (step > afterStep && authenticator.generate(secret, { epoch: step * 30000 }) === token) return step;
  }
  return null;
}

async function getMfaRecord(userId) {
  const result = await pool.query(
    "SELECT secret_encrypted, verified_at FROM erp_user_mfa WHERE user_id = $1",
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
  getPendingSecret,
  verifyTotpStep,
  consumeTotp,
  consumeRecoveryCode,
};
