const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");

test("legal rules are configurable and readable through the HR API", async () => {
  const user = await userService.findUserByEmail(process.env.ADMIN_EMAIL);
  assert.ok(user, "configured administrator must exist");
  const token = tokenService.generateAccessToken(user);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/hr/legal-rules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        rule_group: "leave",
        rule_key: "annual_leave_days",
        rule_value: 21,
        description: "Annual leave entitlement under Kenyan labour law.",
        source_name: "Employment Act, 2007",
        source_url: "https://www.kenyalaw.org/kl/custom/viewbychapter.asp?chapter=31",
        source_date: "2007-01-01",
      }),
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201, JSON.stringify(created));
    assert.equal(created.rule_key, "annual_leave_days");

    const listResponse = await fetch(`${baseUrl}/api/v1/hr/legal-rules?rule_group=leave`, { headers });
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.some((entry) => entry.rule_key === "annual_leave_days"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query("DELETE FROM erp_hr_legal_rules WHERE rule_key = 'annual_leave_days' AND rule_group = 'leave'");
  }
});
