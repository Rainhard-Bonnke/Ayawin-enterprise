const test = require("node:test");
const assert = require("node:assert/strict");

const previousKey = process.env.MFA_ENCRYPTION_KEY;
process.env.MFA_ENCRYPTION_KEY = "integration-test-key-separate-from-jwt-secret";
const { encryptIntegrationSecret, decryptIntegrationSecret } = require("../src/lib/integrationSecrets");

test("integration secrets encrypt and decrypt with the MFA encryption key", () => {
  const secret = "provider-private-credential";
  const encrypted = encryptIntegrationSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.equal(decryptIntegrationSecret(encrypted), secret);
});

test("integration secret ciphertext rejects tampering", () => {
  const encrypted = encryptIntegrationSecret("provider-private-credential");
  const [version, iv, tag, data] = encrypted.split(":");
  const tampered = `${version}:${iv}:${tag}:${Buffer.from(data, "base64").map((byte) => byte ^ 1).toString("base64")}`;

  assert.throws(() => decryptIntegrationSecret(tampered));
});

test("integration secret encryption fails closed without the configured key", () => {
  delete process.env.MFA_ENCRYPTION_KEY;
  assert.throws(() => encryptIntegrationSecret("provider-private-credential"), /MFA_ENCRYPTION_KEY/);
  if (previousKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
  else process.env.MFA_ENCRYPTION_KEY = previousKey;
});