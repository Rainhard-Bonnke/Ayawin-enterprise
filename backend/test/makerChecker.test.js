const test = require("node:test");
const assert = require("node:assert/strict");
const { assertDifferentUser } = require("../src/services/auditService");

test("maker checker compares user ids consistently", () => {
  assert.doesNotThrow(() => assertDifferentUser("1", 2));
  assert.throws(() => assertDifferentUser("1", 1), /cannot approve their own/);
});
