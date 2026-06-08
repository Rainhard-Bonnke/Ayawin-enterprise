const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getKey() {
  const raw = process.env.PII_ENCRYPTION_KEY || '';
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = getKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(ciphertext) {
  if (ciphertext == null || ciphertext === '') return ciphertext;
  if (!isEncrypted(ciphertext)) return ciphertext;
  const key = getKey();
  if (!key) return ciphertext;
  const body = ciphertext.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function protectPartyFields(body) {
  const next = { ...body };
  if (next.tax_id) {
    next.tax_id_enc = encrypt(next.tax_id);
    if (getKey()) next.tax_id = `***${String(next.tax_id).slice(-4)}`;
  }
  if (next.phone) {
    next.phone_enc = encrypt(next.phone);
    if (getKey()) next.phone = `***${String(next.phone).slice(-4)}`;
  }
  return next;
}

function mergeDecryptedRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (row.tax_id_enc) out.tax_id = decrypt(row.tax_id_enc);
  else if (row.tax_id && isEncrypted(row.tax_id)) out.tax_id = decrypt(row.tax_id);
  if (row.phone_enc) out.phone = decrypt(row.phone_enc);
  else if (row.phone && isEncrypted(row.phone)) out.phone = decrypt(row.phone);
  return out;
}

const SALARY_FIELDS = ['basic_salary', 'house_allowance', 'transport_allowance'];

function protectSalaryFields(body) {
  const next = { ...body };
  if (!getKey()) return next;
  for (const field of SALARY_FIELDS) {
    if (next[field] === undefined || next[field] === null) continue;
    next[`${field}_enc`] = encrypt(String(next[field]));
    next[field] = 0;
  }
  return next;
}

function mergeDecryptedSalary(row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of SALARY_FIELDS) {
    const enc = row[`${field}_enc`];
    if (enc) {
      const plain = decrypt(enc);
      const num = Number(plain);
      if (!Number.isNaN(num)) out[field] = num;
    } else if (row[field] != null && isEncrypted(String(row[field]))) {
      const num = Number(decrypt(String(row[field])));
      if (!Number.isNaN(num)) out[field] = num;
    }
  }
  return out;
}

function mergeEmployeeRow(row) {
  return mergeDecryptedSalary(mergeDecryptedRow(row));
}

/** Payroll join row: employee + active contract salary columns. */
function mergePayrollEmployeeRow(row) {
  if (!row) return row;
  const empSal = mergeDecryptedSalary({
    basic_salary: row.basic_salary,
    basic_salary_enc: row.employee_basic_salary_enc,
  });
  const contractSal = mergeDecryptedSalary({
    basic_salary: row.basic_salary,
    basic_salary_enc: row.basic_salary_enc,
    house_allowance: row.house_allowance,
    house_allowance_enc: row.house_allowance_enc,
    transport_allowance: row.transport_allowance,
    transport_allowance_enc: row.transport_allowance_enc,
  });
  return {
    ...row,
    basic_salary: contractSal.basic_salary || empSal.basic_salary,
    house_allowance: contractSal.house_allowance,
    transport_allowance: contractSal.transport_allowance,
  };
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  protectPartyFields,
  mergeDecryptedRow,
  protectSalaryFields,
  mergeDecryptedSalary,
  mergeEmployeeRow,
  mergePayrollEmployeeRow,
  SALARY_FIELDS,
  isEnabled: () => Boolean(getKey()),
};
