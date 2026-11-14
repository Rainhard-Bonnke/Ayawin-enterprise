const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { buildAuditHashChain, hashChainCsvRows } = require("../src/services/auditService");

test("buildAuditHashChain creates a tamper-evident sequence", () => {
  const rows = [
    {
      id: "evt-1",
      entity_type: "erp_invoices",
      entity_id: "inv-001",
      action: "invoice_created",
      created_at: "2026-11-13T10:00:00Z",
      user_id: "user-1",
      new_values: { total: 1250 },
    },
    {
      id: "evt-2",
      entity_type: "erp_invoices",
      entity_id: "inv-001",
      action: "invoice_paid",
      created_at: "2026-11-13T10:05:00Z",
      user_id: "user-2",
      new_values: { status: "paid" },
    },
  ];

  const chain = buildAuditHashChain(rows);
  assert.equal(chain[0].previous_hash, "GENESIS");
  assert.equal(chain[0].hash, crypto.createHash("sha256").update("GENESIS|evt-1|erp_invoices|inv-001|invoice_created|2026-11-13T10:00:00Z|{\"total\":1250}").digest("hex"));
  assert.ok(chain[1].previous_hash === chain[0].hash);
  assert.ok(chain[1].hash !== chain[0].hash);

  const csv = hashChainCsvRows(chain);
  assert.match(csv, /sequence,entity_type,entity_id,action,created_at,previous_hash,hash/);
  assert.match(csv, /evt-1/);
});
