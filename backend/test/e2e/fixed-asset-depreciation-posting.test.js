const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const { postFixedAssetDepreciationRun } = require("../../src/services/fixedAssetDepreciationRunService");

test("E2E depreciation posting creates balanced GL entries and asset run lines", async () => {
  const ctx = await getTestContext();
  const client = await pool.connect();
  const suffix = Date.now();

  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE erp_fixed_assets SET status='disposed' WHERE company_id=$1 AND is_deleted=FALSE AND status='active'",
      [ctx.companyId],
    );
    const year = await client.query(
      `INSERT INTO erp_fiscal_years (
         company_id, year_label, start_date, end_date, created_by
       ) VALUES ($1,$2,'2099-01-01','2099-12-31',$3) RETURNING id`,
      [ctx.companyId, `E2E-ASSET-DEPR-${suffix}`, ctx.userId],
    );
    const period = await client.query(
      `INSERT INTO erp_fiscal_periods (
         company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
       ) VALUES ($1,$2,1,'E2E depreciation posting','2099-01-01','2099-01-31','open',$3) RETURNING id`,
      [ctx.companyId, year.rows[0].id, ctx.userId],
    );
    await client.query(
      `INSERT INTO erp_fixed_assets (
         company_id, asset_code, name, acquisition_date, acquisition_cost,
         residual_value, useful_life_months, created_by
       ) VALUES ($1,$2,'E2E depreciation asset','2099-01-01',12000,0,12,$3)`,
      [ctx.companyId, `E2E-ASSET-DEPR-${suffix}`, ctx.userId],
    );

    const result = await postFixedAssetDepreciationRun({
      companyId: ctx.companyId,
      userId: ctx.userId,
      periodStart: "2099-01-01",
      periodEnd: "2099-01-31",
      client,
    });
    assert.equal(result.run.status, "posted");
    assert.equal(result.summary.total_depreciation, 1000);
    assert.ok(result.run.journal_id);

    const journal = await client.query(
      `SELECT j.status, j.journal_type,
              SUM(line.debit)::numeric AS total_debit,
              SUM(line.credit)::numeric AS total_credit,
              ARRAY_AGG(account.account_code ORDER BY line.line_no) AS account_codes
       FROM erp_journals j
       JOIN erp_journal_lines line ON line.journal_id = j.id
       JOIN erp_chart_of_accounts account ON account.id = line.account_id
       WHERE j.id = $1 AND j.company_id = $2
       GROUP BY j.id`,
      [result.run.journal_id, ctx.companyId],
    );
    assert.equal(journal.rows[0].status, "posted");
    assert.equal(journal.rows[0].journal_type, "depreciation");
    assert.equal(Number(journal.rows[0].total_debit), 1000);
    assert.equal(Number(journal.rows[0].total_credit), 1000);
    assert.deepEqual(journal.rows[0].account_codes, ["6200", "1590"]);

    const lines = await client.query(
      `SELECT COUNT(*)::int AS line_count, SUM(depreciation_amount)::numeric AS total
       FROM erp_fixed_asset_depreciation_run_lines
       WHERE company_id = $1 AND run_id = $2`,
      [ctx.companyId, result.run.id],
    );
    assert.equal(lines.rows[0].line_count, 1);
    assert.equal(Number(lines.rows[0].total), 1000);
    assert.ok(period.rows[0].id);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});