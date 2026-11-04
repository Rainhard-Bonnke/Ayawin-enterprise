const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { authenticateToken } = require("../src/auth");
const { validateSecrets } = require("../src/config/secrets");

test("demo bearer tokens are rejected regardless of legacy environment flags", () => {
  const original = {
    enableDemo: process.env.ENABLE_DEMO_MODE,
    nodeEnv: process.env.NODE_ENV,
  };
  try {
    for (const [enabled, nodeEnv] of [["true", "development"], ["true", "production"], ["false", "development"]]) {
      process.env.ENABLE_DEMO_MODE = enabled;
      process.env.NODE_ENV = nodeEnv;
      let status;
      let continued = false;
      authenticateToken(
        { headers: { authorization: "Bearer demo:x:Admin" } },
        { status(code) { status = code; return this; }, json() {} },
        () => { continued = true; },
      );
      assert.equal(status, 401);
      assert.equal(continued, false);
    }
  } finally {
    if (original.enableDemo === undefined) delete process.env.ENABLE_DEMO_MODE;
    else process.env.ENABLE_DEMO_MODE = original.enableDemo;
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
  }
});

test("startup secret validation requires independent non-placeholder keys", () => {
  assert.throws(() => validateSecrets({ JWT_SECRET: "", MFA_ENCRYPTION_KEY: "x" }), /JWT_SECRET/);
  assert.throws(() => validateSecrets({ JWT_SECRET: "short", MFA_ENCRYPTION_KEY: "x" }), /JWT_SECRET/);
  assert.throws(() => validateSecrets({ JWT_SECRET: "your_jwt_secret_here_min_32_chars", MFA_ENCRYPTION_KEY: "x" }), /JWT_SECRET/);
  assert.throws(() => validateSecrets({ JWT_SECRET: "a".repeat(32), MFA_ENCRYPTION_KEY: "" }), /MFA_ENCRYPTION_KEY/);
  assert.throws(() => validateSecrets({ JWT_SECRET: "a".repeat(32), MFA_ENCRYPTION_KEY: "a".repeat(32) }), /separate/);
  assert.doesNotThrow(() => validateSecrets({ JWT_SECRET: "a".repeat(32), MFA_ENCRYPTION_KEY: "b".repeat(32) }));
});

test("server startup exits when JWT_SECRET is missing", () => {
  const result = spawnSync(process.execPath, ["src/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", JWT_SECRET: "", MFA_ENCRYPTION_KEY: "b".repeat(32) },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /JWT_SECRET must be at least 32 characters/);
});
