const test = require("node:test");
const assert = require("node:assert/strict");
const { createEventHandler } = require("../src/routes/v1/audit");

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("audit event writes are bound to authenticated company and user", async () => {
  let recorded;
  const handler = createEventHandler(async (event) => { recorded = event; });
  const res = responseRecorder();
  await handler({
    body: { action: "customer.updated", company_id: "other-company", details: { source: "ui" } },
    user: { id: "user-a", company_id: "company-a" },
    clientIp: "127.0.0.1",
    get: () => "test-agent",
  }, res, (error) => { throw error; });

  assert.equal(res.statusCode, 201);
  assert.equal(recorded.companyId, "company-a");
  assert.equal(recorded.userId, "user-a");
  assert.equal(recorded.action, "customer.updated");
});

test("audit event rejects a missing action", async () => {
  const handler = createEventHandler(async () => assert.fail("must not write invalid events"));
  const res = responseRecorder();
  await handler({ body: {}, user: { id: "user-a", company_id: "company-a" }, get: () => "" }, res, (error) => { throw error; });

  assert.equal(res.statusCode, 400);
});