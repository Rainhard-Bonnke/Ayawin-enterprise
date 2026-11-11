const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const statements = require("../../src/services/mpesaStatementService");

test("E2E M-Pesa statement import reports unmatched payment variance", async () => {
  const ctx = await getTestContext();
  const statementReference = `E2E-MPESA-STMT-${Date.now()}`;
  const csv = [
    "Transaction ID,Transaction Date,Transaction Type,Amount,Fee,Reference",
    `UNKNOWN-${Date.now()},20261109,payment,50,0,INV-MISSING`,
  ].join("\n");
  let importId;
  try {
    const result = await statements.importMpesaStatement({
      companyId: ctx.companyId, userId: ctx.userId, statementReference, csvText: csv, fileName: "mpesa.csv",
    });
    importId = result.import_id;
    assert.equal(result.row_count, 1);
    assert.equal(result.matched_count, 0);
    assert.equal(result.unmatched_count, 1);
    assert.equal(result.variance_amount, 50);
    const report = await statements.getMpesaStatementVariance({ companyId: ctx.companyId, importId });
    assert.equal(report.statement_reference, statementReference);
    assert.equal(report.lines[0].status, "unmatched");
    assert.equal(Number(report.lines[0].amount), 50);
    assert.equal(Number(report.lines[0].variance_amount), 50);
  } finally {
    if (importId) await pool.query("DELETE FROM erp_mpesa_statement_imports WHERE id=$1 AND company_id=$2", [importId, ctx.companyId]);
  }
});