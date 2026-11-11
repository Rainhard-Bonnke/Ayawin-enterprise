const test = require("node:test");
const assert = require("node:assert/strict");

const previousKeys = {
  mfa: process.env.MFA_ENCRYPTION_KEY,
  integration: process.env.INTEGRATION_ENCRYPTION_KEY,
  version: process.env.INTEGRATION_ENCRYPTION_KEY_VERSION,
};
process.env.MFA_ENCRYPTION_KEY = "legacy-mfa-test-key-separate-from-integration";
process.env.INTEGRATION_ENCRYPTION_KEY = "integration-test-key-separate-from-mfa-key";
process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "test1";
const { encryptIntegrationSecret, decryptIntegrationSecret, rotateIntegrationSecret } = require("../src/lib/integrationSecrets");

test("integration secrets use a separately versioned encryption key", () => {
  const secret = "provider-private-credential";
  const encrypted = encryptIntegrationSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^v2:test1:/);
  assert.equal(decryptIntegrationSecret(encrypted), secret);
});

test("integration secret ciphertext rejects tampering", () => {
  const encrypted = encryptIntegrationSecret("provider-private-credential");
  const [version, iv, tag, data] = encrypted.split(":");
  const tampered = `${version}:${iv}:${tag}:${Buffer.from(data, "base64").map((byte) => byte ^ 1).toString("base64")}`;

  assert.throws(() => decryptIntegrationSecret(tampered));
});

test("integration secret encryption fails closed without the configured key", () => {
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  assert.throws(() => encryptIntegrationSecret("provider-private-credential"), /INTEGRATION_ENCRYPTION_KEY/);
  process.env.INTEGRATION_ENCRYPTION_KEY = "integration-test-key-separate-from-mfa-key";
});

test("legacy MFA-key payloads decrypt and rotate to the current integration key version", () => {
  const legacyKey = require("node:crypto").createHash("sha256").update(process.env.MFA_ENCRYPTION_KEY).digest();
  const iv = require("node:crypto").randomBytes(12);
  const cipher = require("node:crypto").createCipheriv("aes-256-gcm", legacyKey, iv);
  const encrypted = Buffer.concat([cipher.update("legacy-credential", "utf8"), cipher.final()]);
  const legacy = ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
  const rotated = rotateIntegrationSecret(legacy, {
    targetKey: process.env.INTEGRATION_ENCRYPTION_KEY,
    targetKeyVersion: "test2",
  });

  process.env.INTEGRATION_ENCRYPTION_KEY_Vtest2 = process.env.INTEGRATION_ENCRYPTION_KEY;
  assert.equal(decryptIntegrationSecret(rotated), "legacy-credential");
  delete process.env.INTEGRATION_ENCRYPTION_KEY_Vtest2;
});

test.after(() => {
  if (previousKeys.mfa === undefined) delete process.env.MFA_ENCRYPTION_KEY;
  else process.env.MFA_ENCRYPTION_KEY = previousKeys.mfa;
  if (previousKeys.integration === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKeys.integration;
  if (previousKeys.version === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
  else process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = previousKeys.version;
});