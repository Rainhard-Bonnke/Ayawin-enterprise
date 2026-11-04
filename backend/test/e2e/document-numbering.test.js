const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const { nextDocumentNo } = require("../../src/services/documentNumberingService");

test("document sequence allocation is rollback-safe and serial under concurrency", async () => {
  const ctx = await getTestContext();
  const docType = `e2e_sequence_${Date.now()}`;
  const allocate = async (commit) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const number = await nextDocumentNo(client, { companyId: ctx.companyId, docType, prefix: "TST" });
      await client.query(commit ? "COMMIT" : "ROLLBACK");
      return number;
    } finally { client.release(); }
  };
  const rolledBack = await allocate(false);
  assert.equal(await allocate(true), rolledBack);
  const numbers = await Promise.all(Array.from({ length: 50 }, () => allocate(true)));
  const suffixes = numbers.map((number) => Number(number.split("-").at(-1))).sort((a,b) => a-b);
  assert.equal(new Set(numbers).size, 50);
  assert.deepEqual(suffixes, Array.from({ length: 50 }, (_, index) => suffixes[0] + index));
});
