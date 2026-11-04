const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeKraPin } = require("../src/lib/kraPin");

test("KRA PIN is normalized and validated", () => {
  assert.equal(normalizeKraPin(" p123456789a "), "P123456789A");
  assert.equal(normalizeKraPin("A123456789Z"), "A123456789Z");
  for (const invalid of ["123456789A", "B123456789A", "P12345678A", "P1234567890", "P123456789-"]) {
    assert.throws(() => normalizeKraPin(invalid), /KRA PIN must match/);
  }
  assert.equal(normalizeKraPin("  "), null);
});
