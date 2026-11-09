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
