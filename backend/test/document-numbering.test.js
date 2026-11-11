const test = require("node:test");
const assert = require("node:assert/strict");
const { nextDocumentNo } = require("../src/services/documentNumberingService");
const { getTestContext, pool } = require("./e2e/helpers");

test("document numbering keeps journal numbers unique when prior entries already exist", async () => {
  const ctx = await getTestContext();
  const period = await pool.query(
    "SELECT id FROM erp_fiscal_periods WHERE company_id = $1 AND status = 'open' LIMIT 1",
    [ctx.companyId],
  );
  const periodId = period.rows[0]?.id;

  await pool.query(
    `INSERT INTO erp_journals (
       company_id, fiscal_period_id, journal_no, journal_type, entry_date,
       reference_no, description, currency_code, exchange_rate, status,
       source_type, total_debit, total_credit, created_by
     ) VALUES ($1, $2, 'JE-2026-0001', 'general', '2026-05-19', 'seed-1', 'seed', 'KES', 1, 'posted', 'manual', 10, 10, $3)
     ON CONFLICT (company_id, journal_no) DO NOTHING`,
    [ctx.companyId, periodId, ctx.userId],
  );

  const client = await pool.connect();
  try {
    const first = await nextDocumentNo(client, { companyId: ctx.companyId, docType: "erp_journals", prefix: "JE", padding: 4, date: "2026-05-19" });
    const second = await nextDocumentNo(client, { companyId: ctx.companyId, docType: "erp_journals", prefix: "JE", padding: 4, date: "2026-05-19" });

    assert.equal(first, "JE-2026-0002");
    assert.equal(second, "JE-2026-0003");
  } finally {
    await client.release();
    await pool.query("DELETE FROM erp_document_sequences WHERE company_id = $1 AND doc_type = 'journal' AND fiscal_year = 2026", [ctx.companyId]);
    await pool.query("DELETE FROM erp_journals WHERE company_id = $1 AND journal_no LIKE 'JE-2026-%' AND reference_no = 'seed-1'", [ctx.companyId]);
  }
});
