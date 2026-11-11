const test = require("node:test");
const assert = require("node:assert/strict");
const { PRODUCTION_CHECKLISTS, normalizeSettingInput, validateProductionChecklist } = require("../src/services/integrationSettingsService");

test("production provider settings must match their environment", () => {
  assert.throws(() => normalizeSettingInput({ provider: "etims", providerMode: "sandbox", environment: "production" }), /must use the sandbox environment/);
  assert.throws(() => normalizeSettingInput({ provider: "mpesa", providerMode: "production", environment: "sandbox" }), /must use the production environment/);
  assert.equal(normalizeSettingInput({ provider: "etims", providerMode: "sandbox", environment: "sandbox" }).providerMode, "sandbox");
});

test("production certification requires every go-live checklist item", () => {
  for (const provider of ["etims", "mpesa"]) {
    const incomplete = validateProductionChecklist(provider, {});
    assert.equal(incomplete.complete, false);
    assert.deepEqual(incomplete.missing, PRODUCTION_CHECKLISTS[provider]);
    const completed = Object.fromEntries(PRODUCTION_CHECKLISTS[provider].map((item) => [item, true]));
    assert.deepEqual(validateProductionChecklist(provider, completed), { complete: true, missing: [] });
  }
});