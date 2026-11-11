const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PII_ENCRYPTION_KEY ??= "employee-pii-unit-test-key-not-production";

const { encryptEmployeeValue, decryptEmployeeValue, normalizeEmployeePii } = require("../src/lib/employeePii");

test("employee PII encryption round-trips and does not store plaintext", () => {
  const value = "12345678";
  const encrypted = encryptEmployeeValue(value);
  assert.notEqual(encrypted, value);
  assert.equal(decryptEmployeeValue(encrypted), value);
  assert.equal(decryptEmployeeValue(null), null);
});

test("employee PII normalization validates Kenyan national ID and KRA PIN formats", () => {
  const normalized = normalizeEmployeePii({
    national_id: "12345678",
    kra_pin: "A123456789Z",
    nssf_number: "1234567890",
    sha_number: "SHA12345678",
  });
  assert.ok(normalized.national_id_encrypted);
  assert.ok(normalized.kra_pin_encrypted);
  assert.ok(normalized.nssf_number_encrypted);
  assert.ok(normalized.sha_number_encrypted);
  assert.throws(() => normalizeEmployeePii({ national_id: "12A" }), /National ID/);
  assert.throws(() => normalizeEmployeePii({ kra_pin: "invalid" }), /KRA PIN/);
});
