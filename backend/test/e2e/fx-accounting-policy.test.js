const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const fxPolicy = require("../../src/services/fxAccountingPolicyService");

test("FX accounting policy requires explicit controls and independent approval", async () => {
  const context = await getTestContext();
  const accounts = await pool.query(
    `SELECT id, account_type FROM erp_chart_of_accounts
     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE
       AND account_type IN ('asset','liability','income','expense')
     ORDER BY account_code`,
    [context.companyId],
  );
  const findAccount = (type) => accounts.rows.find((account) => account.account_type === type)?.id;
  const policyInput = {
    companyId: context.companyId,
    userId: context.userId,
    currencyCode: "USD",
    rateDirection: "base_per_transaction",
    rateSource: "Finance-approved treasury source",
    effectiveDatePolicy: "exact_date",
    roundingMethod: "currency_minor_half_up",
    realizedGainAccountId: findAccount("income"),
    realizedLossAccountId: findAccount("expense"),
    unrealizedGainAccountId: findAccount("income"),
    unrealizedLossAccountId: findAccount("expense"),
    monetaryAccountIds: [
      accounts.rows.find((account) => account.account_type === "asset")?.id,
      accounts.rows.find((account) => account.account_type === "liability")?.id,
    ],
    reversalPolicy: "next_period_start",
  };
  assert.ok(policyInput.monetaryAccountIds.every(Boolean), "fixture needs postable asset and liability accounts");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const monetaryAccounts = await client.query(
      `INSERT INTO erp_chart_of_accounts (
         company_id, account_code, account_name, account_type, level, is_postable, currency_code, created_by
       ) VALUES
         ($1,$2,'E2E USD Cash','asset',2,TRUE,'USD',$3),
         ($1,$4,'E2E USD Payable','liability',2,TRUE,'USD',$3)
       RETURNING id, account_type`,
      [context.companyId, `FXA-${Date.now()}`, context.userId, `FXL-${Date.now()}`],
    );
    policyInput.monetaryAccountIds = monetaryAccounts.rows.map((account) => account.id);
    await assert.rejects(fxPolicy.createFxAccountingPolicyInTransaction(client, {
      ...policyInput,
      currencyCode: "EUR",
      monetaryAccountIds: [accounts.rows.find((account) => account.account_type === "asset").id],
    }), /must use the FX policy currency/i);
    const draft = await fxPolicy.createFxAccountingPolicyInTransaction(client, policyInput);
    assert.equal(draft.status, "draft");
    assert.equal(draft.foreign_posting_enabled, false);

    await assert.rejects(fxPolicy.approveFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      policyId: draft.id,
    }), /cannot approve their own/i);

    const approved = await fxPolicy.approveFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      policyId: draft.id,
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.foreign_posting_enabled, false);
    await client.query("SAVEPOINT approved_policy_immutable");
    await assert.rejects(client.query(
      "UPDATE erp_fx_accounting_policies SET rate_source='tampered' WHERE id=$1 AND company_id=$2",
      [approved.id, context.companyId],
    ), /FX policy terms are immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT approved_policy_immutable");
    await client.query("RELEASE SAVEPOINT approved_policy_immutable");
    const activePolicy = await fxPolicy.getApprovedFxAccountingPolicy(client, {
      companyId: context.companyId,
      currencyCode: "USD",
    });
    assert.equal(activePolicy.id, approved.id);

    const replacementDraft = await fxPolicy.createFxAccountingPolicyInTransaction(client, {
      ...policyInput,
      rateSource: "Finance-approved treasury source v2",
    });
    assert.equal(replacementDraft.status, "draft");
    const replacement = await fxPolicy.approveFxAccountingPolicyInTransaction(client, {
      companyId: context.companyId,
      userId: context.reviewerId,
      policyId: replacementDraft.id,
    });
    assert.equal(replacement.status, "approved");
    const previous = await client.query(
      "SELECT status,superseded_by FROM erp_fx_accounting_policies WHERE id=$1 AND company_id=$2",
      [approved.id, context.companyId],
    );
    assert.equal(previous.rows[0].status, "superseded");
    assert.equal(previous.rows[0].superseded_by, replacement.id);
    assert.equal((await fxPolicy.getApprovedFxAccountingPolicy(client, {
      companyId: context.companyId,
      currencyCode: "USD",
    })).id, replacement.id);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});