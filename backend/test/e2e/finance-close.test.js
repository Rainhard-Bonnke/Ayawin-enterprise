const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const financeClose = require("../../src/services/financeCloseService");

test("E2E finance close: draft journal blocks closing until resolved", async () => {
  const ctx = await getTestContext();
  const suffix = Date.now();
  let fiscalYearId;
  let fiscalPeriodId;
  let draftJournalId;

  try {
    const year = await pool.query(
      `INSERT INTO erp_fiscal_years (
         company_id, year_label, start_date, end_date, created_by
       ) VALUES ($1,$2,'2099-01-01','2099-12-31',$3) RETURNING id`,
      [ctx.companyId, `E2E-CLOSE-${suffix}`, ctx.userId],
    );
    fiscalYearId = year.rows[0].id;
    const period = await pool.query(
      `INSERT INTO erp_fiscal_periods (
         company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
       ) VALUES ($1,$2,1,'E2E close test','2099-01-01','2099-12-31','open',$3) RETURNING id`,
      [ctx.companyId, fiscalYearId, ctx.userId],
    );
    fiscalPeriodId = period.rows[0].id;
    const journal = await pool.query(
      `INSERT INTO erp_journals (
         company_id, fiscal_period_id, journal_no, journal_type, entry_date,
         status, created_by
       ) VALUES ($1,$2,$3,'general','2099-01-15','draft',$4) RETURNING id`,
      [ctx.companyId, fiscalPeriodId, `E2E-CLOSE-JE-${suffix}`, ctx.userId],
    );
    draftJournalId = journal.rows[0].id;

    const blockedChecklist = await financeClose.getPeriodCloseChecklist(ctx.companyId, fiscalPeriodId);
    assert.equal(blockedChecklist.ready_to_close, false);
    assert.ok(blockedChecklist.blockers.some((blocker) => blocker.code === "unposted_journals" && blocker.count === 1));
    const readiness = await financeClose.getPhaseCReadinessSummary(ctx.companyId, fiscalPeriodId);
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.period_checklist.ready_to_close, false);
    assert.equal(readiness.checks.find((check) => check.code === "foreign_currency_accounting").status, "fail");
    await assert.rejects(
      () => financeClose.closeFiscalPeriod({ companyId: ctx.companyId, periodId: fiscalPeriodId, userId: ctx.userId, reason: "E2E draft check" }),
      (error) => error.code === "FINANCE_CLOSE_BLOCKED" && /Draft journals in period: 1/.test(error.message),
    );

    await pool.query("DELETE FROM erp_journals WHERE id = $1 AND company_id = $2", [draftJournalId, ctx.companyId]);
    draftJournalId = null;
    const readyChecklist = await financeClose.getPeriodCloseChecklist(ctx.companyId, fiscalPeriodId);
    assert.equal(readyChecklist.ready_to_close, true);

    const closed = await financeClose.closeFiscalPeriod({
      companyId: ctx.companyId,
      periodId: fiscalPeriodId,
      userId: ctx.userId,
      reason: "E2E period close",
    });
    assert.equal(closed.period.status, "closed");
    assert.equal(closed.checklist.ready_to_close, true);
  } finally {
    if (draftJournalId) {
      await pool.query("DELETE FROM erp_journals WHERE id = $1 AND company_id = $2", [draftJournalId, ctx.companyId]);
    }
    if (fiscalPeriodId) {
      await pool.query("DELETE FROM erp_fiscal_periods WHERE id = $1 AND company_id = $2", [fiscalPeriodId, ctx.companyId]);
    }
    if (fiscalYearId) {
      await pool.query("DELETE FROM erp_fiscal_years WHERE id = $1 AND company_id = $2", [fiscalYearId, ctx.companyId]);
    }
  }
});

test("E2E finance close: active assets require a posted depreciation run", async () => {
  const ctx = await getTestContext();
  const suffix = Date.now();
  let fiscalYearId;
  let fiscalPeriodId;
  let assetId;
  let depreciationRunId;
  let stocktakeId;

  try {
    const year = await pool.query(
      `INSERT INTO erp_fiscal_years (
         company_id, year_label, start_date, end_date, created_by
       ) VALUES ($1,$2,'2099-01-01','2099-12-31',$3) RETURNING id`,
      [ctx.companyId, `E2E-DEPR-${suffix}`, ctx.userId],
    );
    fiscalYearId = year.rows[0].id;
    const period = await pool.query(
      `INSERT INTO erp_fiscal_periods (
         company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
       ) VALUES ($1,$2,1,'E2E depreciation close','2099-01-01','2099-12-31','open',$3) RETURNING id`,
      [ctx.companyId, fiscalYearId, ctx.userId],
    );
    fiscalPeriodId = period.rows[0].id;
    const asset = await pool.query(
      `INSERT INTO erp_fixed_assets (
         company_id, asset_code, name, acquisition_date, acquisition_cost,
         residual_value, useful_life_months, created_by
       ) VALUES ($1,$2,'E2E close asset','2099-01-01',12000,0,12,$3) RETURNING id`,
      [ctx.companyId, `E2E-DEPR-ASSET-${suffix}`, ctx.userId],
    );
    assetId = asset.rows[0].id;

    const checklist = await financeClose.getPeriodCloseChecklist(ctx.companyId, fiscalPeriodId);
    assert.equal(checklist.ready_to_close, false);
    assert.ok(checklist.blockers.some((blocker) => blocker.code === "depreciation_run_pending" && blocker.count === 1));
    await assert.rejects(
      () => financeClose.closeFiscalPeriod({ companyId: ctx.companyId, periodId: fiscalPeriodId, userId: ctx.userId, reason: "E2E missing depreciation" }),
      (error) => error.code === "FINANCE_CLOSE_BLOCKED" && /Depreciation run not posted for the period: 1/.test(error.message),
    );

    const run = await pool.query(
      `INSERT INTO erp_fixed_asset_depreciation_runs (
         company_id, period_start, period_end, status, total_depreciation, posted_at, created_by
       ) VALUES ($1,'2099-01-01','2099-12-31','posted',12000,NOW(),$2) RETURNING id`,
      [ctx.companyId, ctx.userId],
    );
    depreciationRunId = run.rows[0].id;
    const readyChecklist = await financeClose.getPeriodCloseChecklist(ctx.companyId, fiscalPeriodId);
    assert.equal(readyChecklist.ready_to_close, true);

    const stocktake = await pool.query(
      `INSERT INTO erp_stocktake_sessions (
         company_id, count_no, warehouse_id, title, status, snapshot_at, created_by
       ) VALUES ($1,$2,$3,'E2E close inventory count','counting','2099-01-15T00:00:00Z',$4) RETURNING id`,
      [ctx.companyId, `E2E-CLOSE-STOCKTAKE-${suffix}`, ctx.warehouseId, ctx.userId],
    );
    stocktakeId = stocktake.rows[0].id;
    const inventoryBlockedChecklist = await financeClose.getPeriodCloseChecklist(ctx.companyId, fiscalPeriodId);
    assert.ok(inventoryBlockedChecklist.blockers.some((blocker) => blocker.code === "inventory_variances" && blocker.count === 1));
    await assert.rejects(
      () => financeClose.closeFiscalPeriod({ companyId: ctx.companyId, periodId: fiscalPeriodId, userId: ctx.userId, reason: "E2E unresolved stocktake" }),
      (error) => error.code === "FINANCE_CLOSE_BLOCKED" && /Open inventory variances or reconciliation gaps: 1/.test(error.message),
    );
    await pool.query(
      "UPDATE erp_stocktake_sessions SET status='posted',posted_at=NOW() WHERE id=$1 AND company_id=$2",
      [stocktakeId, ctx.companyId],
    );
    const inventoryClearedChecklist = await financeClose.getPeriodCloseChecklist(ctx.companyId, fiscalPeriodId);
    assert.equal(inventoryClearedChecklist.ready_to_close, true);
  } finally {
    if (stocktakeId) {
      await pool.query("DELETE FROM erp_stocktake_sessions WHERE id = $1 AND company_id = $2", [stocktakeId, ctx.companyId]);
    }
    if (depreciationRunId) {
      await pool.query("DELETE FROM erp_fixed_asset_depreciation_runs WHERE id = $1 AND company_id = $2", [depreciationRunId, ctx.companyId]);
    }
    if (assetId) {
      await pool.query("DELETE FROM erp_fixed_assets WHERE id = $1 AND company_id = $2", [assetId, ctx.companyId]);
    }
    if (fiscalPeriodId) {
      await pool.query("DELETE FROM erp_fiscal_periods WHERE id = $1 AND company_id = $2", [fiscalPeriodId, ctx.companyId]);
    }
    if (fiscalYearId) {
      await pool.query("DELETE FROM erp_fiscal_years WHERE id = $1 AND company_id = $2", [fiscalYearId, ctx.companyId]);
    }
  }
});
