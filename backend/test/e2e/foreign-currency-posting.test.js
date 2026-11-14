const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const gl = require("../../src/services/glPostingService");
const exchangeRates = require("../../src/services/exchangeRateService");
const fxPolicies = require("../../src/services/fxAccountingPolicyService");

test("foreign journals use an approved policy and exact-date rate while the GL stores base currency", async () => {
  const context = await getTestContext();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accounts = await client.query(
      `SELECT id, account_type FROM erp_chart_of_accounts
       WHERE company_id=$1 AND currency_code='KES' AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE
         AND account_type IN ('income','expense') ORDER BY account_code`,
      [context.companyId],
    );
    const incomeAccount = accounts.rows.find((row) => row.account_type === "income")?.id;
    const expenseAccount = accounts.rows.find((row) => row.account_type === "expense")?.id;
    assert.ok(incomeAccount && expenseAccount, "company needs base-currency gain/loss accounts");

    const suffix = Date.now();
    const monetaryAccounts = await client.query(
      `INSERT INTO erp_chart_of_accounts (
         company_id,account_code,account_name,account_type,level,is_postable,currency_code,created_by
       ) VALUES
         ($1,$2,'E2E USD monetary asset','asset',2,TRUE,'USD',$3),
         ($1,$4,'E2E USD monetary liability','liability',2,TRUE,'USD',$3)
       RETURNING id,account_type`,
      [context.companyId, `FXPA-${suffix}`, context.userId, `FXPL-${suffix}`],
    );
    const assetAccount = monetaryAccounts.rows.find((row) => row.account_type === "asset").id;
    const liabilityAccount = monetaryAccounts.rows.find((row) => row.account_type === "liability").id;
    const policy = await fxPolicies.createFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      currencyCode: "USD",
      rateDirection: "base_per_transaction",
      rateSource: `E2E source ${suffix}`,
      effectiveDatePolicy: "exact_date",
      roundingMethod: "currency_minor_half_up",
      realizedGainAccountId: incomeAccount,
      realizedLossAccountId: expenseAccount,
      unrealizedGainAccountId: incomeAccount,
      unrealizedLossAccountId: expenseAccount,
      monetaryAccountIds: [assetAccount, liabilityAccount],
      reversalPolicy: "next_period_start",
    });
    await fxPolicies.approveFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      policyId: policy.id,
    });
    const rate = await exchangeRates.createExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      rate: 150.25,
      effectiveDate: "2026-11-13",
      source: `E2E source ${suffix}`,
    });
    await exchangeRates.approveExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      exchangeRateId: rate.id,
    });

    const baseAccounts = await client.query(
      `SELECT id,account_type FROM erp_chart_of_accounts
       WHERE company_id=$1 AND currency_code='KES' AND account_code=ANY($2::text[])`,
      [context.companyId, ["1100", "2100"]],
    );
    assert.ok(baseAccounts.rowCount >= 1);
    await assert.rejects(gl.createJournalInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      entryDate: "2026-11-13",
      journalType: "adjustment",
      currencyCode: "USD",
      lines: [
        { account_id: baseAccounts.rows[0].id, debit: 10, credit: 0 },
        { account_id: baseAccounts.rows[0].id, debit: 0, credit: 10 },
      ],
    }), /denominated in and scoped by the approved FX policy/i);

    const journal = await gl.createJournalInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      entryDate: "2026-11-13",
      journalType: "adjustment",
      referenceNo: `FX-E2E-${suffix}`,
      description: "Policy-gated foreign-currency journal",
      source: "fx_policy_e2e",
      currencyCode: "USD",
      lines: [
        { account_id: assetAccount, debit: 10, credit: 0 },
        { account_id: liabilityAccount, debit: 0, credit: 10 },
      ],
    });
    assert.equal(Number(journal.total_debit), 1502.5);
    assert.equal(Number(journal.total_credit), 1502.5);

    const lineResult = await client.query(
      `SELECT account_id,debit,credit,transaction_debit,transaction_credit,base_debit,base_credit,
              exchange_rate,exchange_rate_source,exchange_rate_direction,exchange_rate_id,
              exchange_rate_effective_date::text AS effective_date
       FROM erp_journal_lines WHERE journal_id=$1 ORDER BY line_no`,
      [journal.id],
    );
    assert.equal(Number(lineResult.rows[0].transaction_debit), 10);
    assert.equal(Number(lineResult.rows[0].base_debit), 1502.5);
    assert.equal(Number(lineResult.rows[1].transaction_credit), 10);
    assert.equal(Number(lineResult.rows[1].base_credit), 1502.5);
    for (const line of lineResult.rows) {
      assert.equal(Number(line.exchange_rate), 150.25);
      assert.equal(line.exchange_rate_source, `E2E source ${suffix}`);
      assert.equal(line.exchange_rate_direction, "base_per_transaction");
      assert.equal(line.exchange_rate_id, rate.id);
      assert.equal(line.effective_date, "2026-11-13");
      assert.equal(Number(line.debit), Number(line.base_debit));
      assert.equal(Number(line.credit), Number(line.base_credit));
    }

    await gl.postJournalInTransaction(client, {
      journalId: journal.id,
      companyId: context.companyId,
      userId: context.userId,
    });
    const stored = await client.query(
      "SELECT status,total_debit,total_credit,currency_code FROM erp_journals WHERE id=$1",
      [journal.id],
    );
    assert.equal(stored.rows[0].status, "posted");
    assert.equal(stored.rows[0].currency_code, "USD");
    assert.equal(Number(stored.rows[0].total_debit), 1502.5);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});