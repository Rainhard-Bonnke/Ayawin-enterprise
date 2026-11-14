const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const {
  createExchangeRateInTransaction,
  approveExchangeRateInTransaction,
  getApprovedExchangeRateForDate,
  rejectExchangeRateInTransaction,
} = require("../../src/services/exchangeRateService");
const {
  createFxAccountingPolicyInTransaction,
  approveFxAccountingPolicyInTransaction,
} = require("../../src/services/fxAccountingPolicyService");

test("exchange rates are created as drafts and require independent approval before reuse", async () => {
  const context = await getTestContext();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accounts = await client.query(
      `SELECT id, account_type FROM erp_chart_of_accounts
       WHERE company_id=$1 AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE
       ORDER BY account_code`,
      [context.companyId],
    );
    const accountOfType = (type) => accounts.rows.find((row) => row.account_type === type)?.id;
    const monetaryAccounts = await client.query(
      `INSERT INTO erp_chart_of_accounts (
         company_id, account_code, account_name, account_type, level, is_postable, currency_code, created_by
       ) VALUES
         ($1,$2,'E2E USD Cash','asset',2,TRUE,'USD',$3),
         ($1,$4,'E2E USD Payable','liability',2,TRUE,'USD',$3)
       RETURNING id`,
      [context.companyId, `FXA-${Date.now()}`, context.userId, `FXL-${Date.now()}`],
    );
    const policy = await createFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      currencyCode: "USD",
      rateDirection: "base_per_transaction",
      rateSource: "Finance-approved treasury source",
      effectiveDatePolicy: "exact_date",
      roundingMethod: "currency_minor_half_up",
      realizedGainAccountId: accountOfType("income"),
      realizedLossAccountId: accountOfType("expense"),
      unrealizedGainAccountId: accountOfType("income"),
      unrealizedLossAccountId: accountOfType("expense"),
      monetaryAccountIds: monetaryAccounts.rows.map((row) => row.id),
      reversalPolicy: "next_period_start",
    });
    await approveFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      policyId: policy.id,
    });
    const draft = await createExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      rate: 151.25,
      effectiveDate: "2026-11-13",
      source: "Finance-approved treasury source",
    });
    assert.equal(draft.status, "draft");
    assert.equal(await getApprovedExchangeRateForDate(client, {
      companyId: context.companyId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      effectiveDate: "2026-11-13",
    }), null);
    await assert.rejects(
      approveExchangeRateInTransaction(client, {
        companyId: context.companyId,
        userId: context.userId,
        exchangeRateId: draft.id,
      }),
      /cannot approve their own/i,
    );

    const approved = await approveExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: "9a62cc7a-fdc2-426a-9899-0b825d98c321",
      exchangeRateId: draft.id,
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.approved_by, "9a62cc7a-fdc2-426a-9899-0b825d98c321");
    assert.ok(approved.approved_at);
    await client.query("SAVEPOINT approved_rate_immutable");
    await assert.rejects(client.query(
      "UPDATE erp_exchange_rates SET rate=999 WHERE id=$1 AND company_id=$2",
      [approved.id, context.companyId],
    ), /exchange-rate terms are immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT approved_rate_immutable");
    await client.query("RELEASE SAVEPOINT approved_rate_immutable");
    assert.equal((await getApprovedExchangeRateForDate(client, {
      companyId: context.companyId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      effectiveDate: "2026-11-13",
    })).id, approved.id);

    const policyMismatchDraft = await createExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      rate: 151.75,
      effectiveDate: "2026-11-14",
      source: "Unapproved alternate feed",
    });
    await approveExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      exchangeRateId: policyMismatchDraft.id,
    });
    assert.equal(await getApprovedExchangeRateForDate(client, {
      companyId: context.companyId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      effectiveDate: "2026-11-14",
    }), null);

    await client.query("SAVEPOINT duplicate_rate");
    await assert.rejects(createExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      fromCurrencyCode: "USD",
      toCurrencyCode: "KES",
      rate: 152,
      effectiveDate: "2026-11-13",
      source: "replacement rate",
    }), /already exists|duplicate/i);
    await client.query("ROLLBACK TO SAVEPOINT duplicate_rate");
    await client.query("RELEASE SAVEPOINT duplicate_rate");

    const rejectedDraft = await createExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      fromCurrencyCode: "EUR",
      toCurrencyCode: "KES",
      rate: 163.4,
      effectiveDate: "2026-11-13",
      source: "market reference",
    });
    await assert.rejects(rejectExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: "9a62cc7a-fdc2-426a-9899-0b825d98c321",
      exchangeRateId: rejectedDraft.id,
      reason: " ",
    }), /reason is required/i);
    const rejected = await rejectExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: "9a62cc7a-fdc2-426a-9899-0b825d98c321",
      exchangeRateId: rejectedDraft.id,
      reason: "Source does not meet the approved policy",
    });
    assert.equal(rejected.status, "rejected");
    const replacement = await createExchangeRateInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      fromCurrencyCode: "EUR",
      toCurrencyCode: "KES",
      rate: 163.6,
      effectiveDate: "2026-11-13",
      source: "verified market reference",
    });
    assert.equal(replacement.status, "draft");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});