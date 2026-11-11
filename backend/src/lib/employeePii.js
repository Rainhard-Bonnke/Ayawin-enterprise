const crypto = require("crypto");

const VERSION = "pii-v1";

function piiKey() {
  const configured = process.env.PII_ENCRYPTION_KEY || "";
  if (configured.length < 32) throw new Error("PII_ENCRYPTION_KEY must contain at least 32 characters");
  return crypto.createHash("sha256").update(configured, "utf8").digest();
}

function encryptEmployeeValue(value) {
  if (value == null || String(value).trim() === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", piiKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value).trim(), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptEmployeeValue(payload) {
  if (payload == null || payload === "") return null;
  const [version, ivText, tagText, encryptedText, ...extra] = String(payload).split(":");
  if (version !== VERSION || !ivText || !tagText || !encryptedText || extra.length) {
    throw new Error("Encrypted employee field has an unsupported format");
  }
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const encrypted = Buffer.from(encryptedText, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error("Encrypted employee field is malformed");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", piiKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function normalizeEmployeePii(input = {}) {
  const nationalId = String(input.national_id ?? "").replace(/\s+/g, "");
  const kraPin = String(input.kra_pin ?? "").trim().toUpperCase();
  const nssfNumber = String(input.nssf_number ?? "").trim().toUpperCase();
  const shaNumber = String(input.sha_number ?? "").trim().toUpperCase();
  const bankAccount = String(input.bank_account_no ?? "").trim();

  if (nationalId && !/^\d{7,10}$/.test(nationalId)) throw new Error("National ID must contain 7 to 10 digits");
  if (kraPin && !/^[A-Z]\d{9}[A-Z]$/.test(kraPin)) throw new Error("KRA PIN must match the Kenyan PIN format");
  if (nssfNumber && !/^[A-Z0-9-]{6,24}$/.test(nssfNumber)) throw new Error("NSSF number has an invalid format");
  if (shaNumber && !/^[A-Z0-9-]{6,24}$/.test(shaNumber)) throw new Error("SHA number has an invalid format");

  return {
    national_id_encrypted: encryptEmployeeValue(nationalId || null),
    kra_pin_encrypted: encryptEmployeeValue(kraPin || null),
    nssf_number_encrypted: encryptEmployeeValue(nssfNumber || null),
    sha_number_encrypted: encryptEmployeeValue(shaNumber || null),
    bank_account_no_encrypted: encryptEmployeeValue(bankAccount || null),
  };
}

module.exports = { encryptEmployeeValue, decryptEmployeeValue, normalizeEmployeePii };