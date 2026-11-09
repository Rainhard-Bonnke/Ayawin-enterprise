const crypto = require("crypto");

const VERSION = "v1";

function getEncryptionKey() {
  const configuredKey = process.env.MFA_ENCRYPTION_KEY;
  if (!configuredKey || configuredKey.length < 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be configured before storing integration secrets");
  }
  return crypto.createHash("sha256").update(configuredKey, "utf8").digest();
}

function encryptIntegrationSecret(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Integration secret must be a non-empty string");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

function decryptIntegrationSecret(payload) {
  if (typeof payload !== "string") throw new Error("Encrypted integration secret is invalid");
  const [version, ivValue, tagValue, encryptedValue, ...extra] = payload.split(":");
  if (version !== VERSION || !ivValue || !tagValue || encryptedValue === undefined || extra.length) {
    throw new Error("Encrypted integration secret has an unsupported format");
  }
  const iv = Buffer.from(ivValue, "base64");
  const tag = Buffer.from(tagValue, "base64");
  const encrypted = Buffer.from(encryptedValue, "base64");
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error("Encrypted integration secret has invalid data");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

module.exports = { encryptIntegrationSecret, decryptIntegrationSecret };