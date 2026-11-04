const test = require("node:test");
const assert = require("node:assert/strict");
const gl = require("../src/services/glPostingService");
const { ipMatchesCidr } = require("../src/services/userService");
const { validateWebhookUrl } = require("../src/services/webhookService");

test("profit and loss calculates income less expenses", () => {
  assert.deepEqual(gl.calculateProfitLoss([
    { account_type: "income", credit: 1000, debit: 0 },
    { account_type: "expense", debit: 400, credit: 0 },
  ]), { income: 1000, expense: 400, net_profit: 600 });
});

test("IP whitelist uses CIDR boundaries rather than string prefixes", () => {
  assert.equal(ipMatchesCidr("10.2.3.4", "10.2.0.0/16"), true);
  assert.equal(ipMatchesCidr("10.20.3.4", "10.2.0.0/16"), false);
  assert.equal(ipMatchesCidr("192.168.1.5", "192.168.1.0/24"), true);
  assert.equal(ipMatchesCidr("192.168.2.5", "192.168.1.0/24"), false);
});

test("webhook subscriptions reject loopback and private addresses", async () => {
  await assert.rejects(validateWebhookUrl("https://127.0.0.1/hook"), /non-public|metadata/);
  await assert.rejects(validateWebhookUrl("http://example.com/hook"), /HTTPS/);
});
