const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { getTestContext, pool } = require("./helpers");
const fxPolicies = require("../../src/services/fxAccountingPolicyService");
const exchangeRates = require("../../src/services/exchangeRateService");
const fxRevaluations = require("../../src/services/fxRevaluationService");
const gl = require("../../src/services/glPostingService");
const financeClose = require("../../src/services/financeCloseService");

test("FX revaluation posts scoped balance adjustments and automatic next-period reversals", async () => {
  const context = await getTestContext();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const company = await client.query("SELECT base_currency_code FROM erp_companies WHERE id=$1", [context.companyId]);
    const baseCurrency = String(company.rows[0].base_currency_code).trim();
    const assetCode = `FXA-${suffix}`;
    const liabilityCode = `FXL-${suffix}`;
    const monetary = await client.query(
      `INSERT INTO erp_chart_of_accounts (
         company_id, account_code, account_name, account_type, level,
         is_postable, currency_code, created_by
       ) VALUES
         ($1,$2,'E2E FX USD asset','asset',2,TRUE,'USD',$3),
         ($1,$4,'E2E FX USD liability','liability',2,TRUE,'USD',$3)
       RETURNING id, account_type`,
      [context.companyId, assetCode, context.userId, liabilityCode],
    );
    const monetaryIds = monetary.rows.map((row) => row.id);
    const baseAccounts = await client.query(
      `SELECT id, account_type FROM erp_chart_of_accounts
       WHERE company_id=$1 AND currency_code=$2 AND is_active=TRUE AND is_postable=TRUE AND is_deleted=FALSE
         AND account_type IN ('income','expense') ORDER BY account_code`,
      [context.companyId, baseCurrency],
    );
    const gainAccount = baseAccounts.rows.find((row) => row.account_type === "income");
    const lossAccount = baseAccounts.rows.find((row) => row.account_type === "expense");
    assert.ok(gainAccount && lossAccount);

    const fiscalYear = await client.query(
      `INSERT INTO erp_fiscal_years (company_id, year_label, start_date, end_date, created_by)
       VALUES ($1,$2,'2601-01-01','2601-12-31',$3) RETURNING id`,
      [context.companyId, `E2E-FX-REVAL-${suffix}`, context.userId],
    );
    const firstPeriod = await client.query(
      `INSERT INTO erp_fiscal_periods (
         company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
       ) VALUES ($1,$2,1,'E2E FX January','2601-01-01','2601-01-31','open',$3) RETURNING id`,
      [context.companyId, fiscalYear.rows[0].id, context.userId],
    );
    await client.query(
      `INSERT INTO erp_fiscal_periods (
         company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
       ) VALUES ($1,$2,2,'E2E FX February','2601-02-01','2601-02-28','open',$3)`,
      [context.companyId, fiscalYear.rows[0].id, context.userId],
    );

    const policy = await fxPolicies.createFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      currencyCode: "USD",
      rateDirection: "base_per_transaction",
      rateSource: `E2E Treasury ${suffix}`,
      effectiveDatePolicy: "exact_date",
      roundingMethod: "currency_minor_half_up",
      realizedGainAccountId: gainAccount.id,
      realizedLossAccountId: lossAccount.id,
      unrealizedGainAccountId: gainAccount.id,
      unrealizedLossAccountId: lossAccount.id,
      monetaryAccountIds: monetaryIds,
      reversalPolicy: "next_period_start",
    });
    await fxPolicies.approveFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      policyId: policy.id,
    });
    for (const [effectiveDate, rateValue] of [["2601-01-15", 100], ["2601-01-31", 110]]) {
      const rate = await exchangeRates.createExchangeRateInTransaction(client, {
        companyId: context.companyId,
        userId: context.userId,
        fromCurrencyCode: "USD",
        toCurrencyCode: baseCurrency,
        rate: rateValue,
        effectiveDate,
        source: `E2E Treasury ${suffix}`,
      });
      await exchangeRates.approveExchangeRateInTransaction(client, {
        companyId: context.companyId,
        userId: context.reviewerId,
        exchangeRateId: rate.id,
      });
    }

    const source = await gl.createJournalInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      entryDate: "2601-01-15",
      journalType: "general",
      description: "E2E foreign-currency monetary balances",
      currencyCode: "USD",
      source: "module",
      lines: [
        { account_id: monetary.rows[0].id, debit: 1000, credit: 0 },
        { account_id: monetary.rows[1].id, debit: 0, credit: 1000 },
      ],
    });
    await gl.postJournalInTransaction(client, {
      journalId: source.id,
      companyId: context.companyId,
      userId: context.userId,
    });

    const pendingClose = await financeClose.getPeriodCloseChecklist(
      context.companyId,
      firstPeriod.rows[0].id,
      client,
    );
    assert.ok(pendingClose.blockers.some((blocker) => blocker.code === "fx_revaluation_pending"));

    const result = await fxRevaluations.postFxPeriodRevaluation({
      companyId: context.companyId,
      userId: context.reviewerId,
      periodId: firstPeriod.rows[0].id,
      currencyCode: "USD",
      client,
    });
    assert.equal(Number(result.run.closing_rate), 110);
    assert.equal(Number(result.run.total_gain), 10000);
    assert.equal(Number(result.run.total_loss), 10000);
    assert.equal(result.lines.length, 2);
    assert.ok(result.run.journal_id);
    assert.ok(result.run.reversal_journal_id);
    const revaluedClose = await financeClose.getPeriodCloseChecklist(
      context.companyId,
      firstPeriod.rows[0].id,
      client,
    );
    assert.equal(revaluedClose.blockers.some((blocker) => blocker.code === "fx_revaluation_pending"), false);

    const journals = await client.query(
      `SELECT id, status, entry_date::text AS entry_date, reversal_of_id, total_debit, total_credit
       FROM erp_journals WHERE id=ANY($1::uuid[]) ORDER BY entry_date`,
      [[result.run.journal_id, result.run.reversal_journal_id]],
    );
    assert.equal(journals.rowCount, 2);
    assert.equal(journals.rows[0].status, "posted");
    assert.equal(journals.rows[0].entry_date, "2601-01-31");
    assert.equal(journals.rows[1].status, "posted");
    assert.equal(journals.rows[1].entry_date, "2601-02-01");
    assert.equal(journals.rows[1].reversal_of_id, result.run.journal_id);
    assert.equal(Number(journals.rows[0].total_debit), Number(journals.rows[0].total_credit));
    assert.equal(Number(journals.rows[1].total_debit), Number(journals.rows[1].total_credit));
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});