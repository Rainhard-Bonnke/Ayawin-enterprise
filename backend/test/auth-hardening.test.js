const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { authenticateErp } = require("../src/middleware/erpAuth");
const { validateSecrets } = require("../src/config/secrets");

test("ERP authentication rejects demo bearer tokens", async () => {
  let status;
  let continued = false;
  await authenticateErp(
    { headers: { authorization: "Bearer demo:x:Admin" } },
    { status(code) { status = code; return this; }, json() {} },
    () => { continued = true; },
  );
  assert.equal(status, 401);
  assert.equal(continued, false);
});

test("startup secret validation requires independent non-placeholder keys", () => {
  const valid = {
    JWT_SECRET: "a".repeat(32),
    MFA_ENCRYPTION_KEY: "b".repeat(32),
    INTEGRATION_ENCRYPTION_KEY: "c".repeat(32),
    PII_ENCRYPTION_KEY: "d".repeat(32),
  };
  assert.throws(() => validateSecrets({ ...valid, JWT_SECRET: "" }), /JWT_SECRET/);
  assert.throws(() => validateSecrets({ ...valid, JWT_SECRET: "short" }), /JWT_SECRET/);
  assert.throws(() => validateSecrets({ ...valid, JWT_SECRET: "your_jwt_secret_here_min_32_chars" }), /JWT_SECRET/);
  assert.throws(() => validateSecrets({ ...valid, MFA_ENCRYPTION_KEY: "" }), /MFA_ENCRYPTION_KEY/);
  assert.throws(() => validateSecrets({ ...valid, MFA_ENCRYPTION_KEY: valid.JWT_SECRET }), /separate/);
  assert.throws(() => validateSecrets({ ...valid, INTEGRATION_ENCRYPTION_KEY: "" }), /INTEGRATION_ENCRYPTION_KEY/);
  assert.throws(() => validateSecrets({ ...valid, INTEGRATION_ENCRYPTION_KEY: valid.MFA_ENCRYPTION_KEY }), /separate/);
  assert.throws(() => validateSecrets({ ...valid, PII_ENCRYPTION_KEY: "" }), /PII_ENCRYPTION_KEY/);
  assert.throws(() => validateSecrets({ ...valid, PII_ENCRYPTION_KEY: valid.JWT_SECRET }), /separate/);
  assert.doesNotThrow(() => validateSecrets(valid));
});

test("server startup exits when JWT_SECRET is missing", () => {
  const result = spawnSync(process.execPath, ["src/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", JWT_SECRET: "", MFA_ENCRYPTION_KEY: "b".repeat(32), INTEGRATION_ENCRYPTION_KEY: "c".repeat(32), PII_ENCRYPTION_KEY: "d".repeat(32) },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /JWT_SECRET must be at least 32 characters/);
});
