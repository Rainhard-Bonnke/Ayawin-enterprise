const crypto = require("crypto");

const LEGACY_VERSION = "v1";
const VERSION = "v2";

function deriveKey(configuredKey, keyName) {
  if (!configuredKey || configuredKey.length < 32) {
    throw new Error(`${keyName} must contain at least 32 characters`);
  }
  return crypto.createHash("sha256").update(configuredKey, "utf8").digest();
}

function getIntegrationKey(keyVersion = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || "1") {
  const activeVersion = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || "1";
  const keyName = String(keyVersion) === String(activeVersion)
    ? "INTEGRATION_ENCRYPTION_KEY"
    : `INTEGRATION_ENCRYPTION_KEY_V${keyVersion}`;
  return deriveKey(process.env[keyName], keyName);
}

function encryptWithKey(value, key, keyVersion) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Integration secret must be a non-empty string");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, keyVersion, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

function encryptIntegrationSecret(value) {
  const keyVersion = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || "1";
  return encryptWithKey(value, getIntegrationKey(keyVersion), keyVersion);
}

function decryptWithKey(payload, key) {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const encrypted = Buffer.from(payload.encrypted, "base64");
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error("Encrypted integration secret has invalid data");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function parsePayload(payload) {
  if (typeof payload !== "string") throw new Error("Encrypted integration secret is invalid");
  const parts = payload.split(":");
  const [version] = parts;
  if (version === LEGACY_VERSION && parts.length === 4) {
    const [, iv, tag, encrypted] = parts;
    if (!iv || !tag || encrypted === undefined) throw new Error("Encrypted integration secret has an unsupported format");
    return { version, iv, tag, encrypted };
  }
  if (version !== VERSION || parts.length !== 5) {
    throw new Error("Encrypted integration secret has an unsupported format");
  }
  const [, keyVersion, iv, tag, encrypted] = parts;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyVersion) || !iv || !tag || encrypted === undefined) {
    throw new Error("Encrypted integration secret has an unsupported format");
  }
  return { version, keyVersion, iv, tag, encrypted };
}

function decryptIntegrationSecret(payload) {
  const parsed = parsePayload(payload);
  const key = parsed.version === LEGACY_VERSION
    ? deriveKey(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY")
    : getIntegrationKey(parsed.keyVersion);
  return decryptWithKey(parsed, key);
}

function rotateIntegrationSecret(payload, { sourceKey, targetKey, targetKeyVersion }) {
  if (!targetKeyVersion || !/^[A-Za-z0-9_-]{1,32}$/.test(String(targetKeyVersion))) {
    throw new Error("A valid target integration key version is required");
  }
  const parsed = parsePayload(payload);
  const source = parsed.version === LEGACY_VERSION
    ? deriveKey(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY")
    : deriveKey(sourceKey, "INTEGRATION_ENCRYPTION_KEY_OLD");
  const target = deriveKey(targetKey, "INTEGRATION_ENCRYPTION_KEY_NEXT");
  const plaintext = decryptWithKey(parsed, source);
  return encryptWithKey(plaintext, target, String(targetKeyVersion));
}

module.exports = { decryptIntegrationSecret, encryptIntegrationSecret, rotateIntegrationSecret };