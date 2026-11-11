const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticator } = require("otplib");

process.env.MFA_ENCRYPTION_KEY ??= "mfa-service-test-key-independent-32chars";

const { verifyTotpStep } = require("../src/services/mfaService");

test("TOTP verification identifies candidate steps and rejects replayed steps", () => {
  const originalNow = Date.now;
  const currentStep = 1_000_000;
  const secret = authenticator.generateSecret();
  const codeAt = (step) => authenticator.clone({ epoch: step * 30_000 }).generate(secret);

  try {
    Date.now = () => currentStep * 30_000 + 1_000;
    assert.equal(verifyTotpStep(secret, codeAt(currentStep)), currentStep);
    assert.equal(verifyTotpStep(secret, codeAt(currentStep - 1)), currentStep - 1);
    assert.equal(verifyTotpStep(secret, codeAt(currentStep + 1)), currentStep + 1);
    assert.equal(verifyTotpStep(secret, codeAt(currentStep), currentStep), null);
    assert.equal(verifyTotpStep(secret, codeAt(currentStep + 1), currentStep), currentStep + 1);
  } finally {
    Date.now = originalNow;
  }
});