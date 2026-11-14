const { assertDifferentUser, logAudit } = require("./auditService");

const RATE_DIRECTIONS = new Set(["base_per_transaction", "transaction_per_base"]);
const EFFECTIVE_DATE_POLICIES = new Set(["exact_date"]);
const ROUNDING_METHODS = new Set(["currency_minor_half_up"]);
const REVERSAL_POLICIES = new Set(["next_period_start"]);

function normalizeFxAccountingPolicy(input = {}) {
  const currencyCode = String(input.currencyCode || "").trim().toUpperCase();
  const rateDirection = String(input.rateDirection || "").trim();
  const rateSource = String(input.rateSource || "").trim();
  const effectiveDatePolicy = String(input.effectiveDatePolicy || "").trim();
  const roundingMethod = String(input.roundingMethod || "").trim();
  const reversalPolicy = String(input.reversalPolicy || "").trim();
  const monetaryAccountIds = [...new Set((input.monetaryAccountIds || []).map((id) => String(id).trim()).filter(Boolean))];

  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Foreign currency must be a three-letter ISO code");
  if (!RATE_DIRECTIONS.has(rateDirection)) throw new Error("Choose a supported exchange-rate direction");
  if (!rateSource) throw new Error("An approved rate source is required");
  if (!EFFECTIVE_DATE_POLICIES.has(effectiveDatePolicy)) throw new Error("Only exact effective-date rate selection is currently supported");
  if (!ROUNDING_METHODS.has(roundingMethod)) throw new Error("Choose a supported currency rounding method");
  if (!REVERSAL_POLICIES.has(reversalPolicy)) throw new Error("Choose a supported revaluation reversal policy");
  if (!monetaryAccountIds.length) throw new Error("Select at least one eligible monetary account");

  const accountIds = {
    realizedGainAccountId: input.realizedGainAccountId,
    realizedLossAccountId: input.realizedLossAccountId,
    unrealizedGainAccountId: input.unrealizedGainAccountId,
    unrealizedLossAccountId: input.unrealizedLossAccountId,
  };
  for (const [field, value] of Object.entries(accountIds)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""))) {
      throw new Error(`${field} must select a valid chart-of-accounts id`);
    }
  }

  return {
    currencyCode,
    rateDirection,
    rateSource,
    effectiveDatePolicy,
    roundingMethod,
    reversalPolicy,
    monetaryAccountIds,
    ...accountIds,
  };
}

async function validatePolicyAccounts(client, { companyId, policy, foreignCurrencyCode, baseCurrencyCode }) {
  const gainIds = [policy.realized_gain_account_id, policy.unrealized_gain_account_id];
  const lossIds = [policy.realized_loss_account_id, policy.unrealized_loss_account_id];
  const monetaryIds = policy.monetary_account_ids;
  const allIds = [...new Set([...gainIds, ...lossIds, ...monetaryIds])];
  const result = await client.query(
    `SELECT id, account_type, currency_code, is_active, is_deleted, is_postable
     FROM erp_chart_of_accounts
     WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, allIds],
  );
  const accounts = new Map(result.rows.map((account) => [account.id, account]));
  if (accounts.size !== allIds.length || result.rows.some((account) => !account.is_active || account.is_deleted || !account.is_postable)) {
    throw new Error("FX policy accounts must be active, postable accounts in this company");
  }
  for (const accountId of gainIds) {
    if (accounts.get(accountId).account_type !== "income") throw new Error("FX gain accounts must be income accounts");
  }
  for (const accountId of lossIds) {
    if (accounts.get(accountId).account_type !== "expense") throw new Error("FX loss accounts must be expense accounts");
  }
  for (const accountId of [...gainIds, ...lossIds]) {
    if (String(accounts.get(accountId).currency_code || "").trim().toUpperCase() !== baseCurrencyCode) {
      throw new Error("FX gain and loss accounts must use the company base currency");
    }
  }
  for (const accountId of monetaryIds) {
    if (!["asset", "liability"].includes(accounts.get(accountId).account_type)) {
      throw new Error("Eligible monetary accounts must be asset or liability accounts");
    }
    if (String(accounts.get(accountId).currency_code || "").trim().toUpperCase() !== foreignCurrencyCode) {
      throw new Error("Eligible monetary accounts must use the FX policy currency");
    }
  }
}

async function createFxAccountingPolicyInTransaction(client, input) {
  const policy = normalizeFxAccountingPolicy(input);
  const company = await client.query(
    `SELECT base_currency_code FROM erp_companies
     WHERE id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
    [input.companyId],
  );
  if (!company.rowCount) throw new Error("Company not found or inactive");
  const baseCurrencyCode = String(company.rows[0].base_currency_code).trim().toUpperCase();
  if (baseCurrencyCode === policy.currencyCode) throw new Error("FX policy currency must differ from the company base currency");
  const currencies = await client.query(
    "SELECT code FROM erp_currencies WHERE code = ANY($1::char(3)[]) AND is_active = TRUE",
    [[policy.currencyCode, baseCurrencyCode]],
  );
  if (currencies.rowCount !== 2) throw new Error("FX policy currencies must both be active in the currency registry");

  const accountPolicy = {
    realized_gain_account_id: policy.realizedGainAccountId,
    realized_loss_account_id: policy.realizedLossAccountId,
    unrealized_gain_account_id: policy.unrealizedGainAccountId,
    unrealized_loss_account_id: policy.unrealizedLossAccountId,
    monetary_account_ids: policy.monetaryAccountIds,
  };
  await validatePolicyAccounts(client, {
    companyId: input.companyId,
    policy: accountPolicy,
    foreignCurrencyCode: policy.currencyCode,
    baseCurrencyCode,
  });
  const result = await client.query(
    `INSERT INTO erp_fx_accounting_policies (
       company_id, currency_code, base_currency_code, rate_direction, rate_source,
       effective_date_policy, rounding_method, realized_gain_account_id, realized_loss_account_id,
       unrealized_gain_account_id, unrealized_loss_account_id, monetary_account_ids,
       reversal_policy, status, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid[],$13,'draft',$14,$14)
     RETURNING *`,
    [input.companyId, policy.currencyCode, baseCurrencyCode, policy.rateDirection, policy.rateSource,
      policy.effectiveDatePolicy, policy.roundingMethod, policy.realizedGainAccountId,
      policy.realizedLossAccountId, policy.unrealizedGainAccountId, policy.unrealizedLossAccountId,
      policy.monetaryAccountIds, policy.reversalPolicy, input.userId],
  );
  const draft = result.rows[0];
  await logAudit({
    companyId: input.companyId,
    userId: input.userId,
    entityType: "erp_fx_accounting_policies",
    entityId: draft.id,
    action: "create_draft",
    newValues: draft,
    client,
  });
  return draft;
}

async function getFxPolicyForReview(client, { companyId, policyId }) {
  const result = await client.query(
    `SELECT * FROM erp_fx_accounting_policies
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
    [policyId, companyId],
  );
  const policy = result.rows[0];
  if (!policy) {
    const error = new Error("FX accounting policy not found");
    error.code = "FX_POLICY_NOT_FOUND";
    throw error;
  }
  if (policy.status !== "draft") {
    const error = new Error("Only a draft FX accounting policy can be reviewed");
    error.code = "FX_POLICY_INVALID_STATE";
    throw error;
  }
  return policy;
}

async function approveFxAccountingPolicyInTransaction(client, { companyId, userId, policyId }) {
  const policy = await getFxPolicyForReview(client, { companyId, policyId });
  assertDifferentUser(policy.created_by, userId);
  const company = await client.query(
    "SELECT base_currency_code FROM erp_companies WHERE id = $1 AND is_active = TRUE AND is_deleted = FALSE",
    [companyId],
  );
  if (!company.rowCount || String(company.rows[0].base_currency_code).trim() !== String(policy.base_currency_code).trim()) {
    throw new Error("Company base currency changed; create a new FX policy using the current base currency");
  }
  await validatePolicyAccounts(client, {
    companyId,
    policy,
    foreignCurrencyCode: policy.currency_code,
    baseCurrencyCode: String(policy.base_currency_code).trim().toUpperCase(),
  });
  const priorResult = await client.query(
    `SELECT * FROM erp_fx_accounting_policies
     WHERE company_id = $1 AND currency_code = $2 AND status = 'approved'
       AND is_deleted = FALSE AND id <> $3
     FOR UPDATE`,
    [companyId, policy.currency_code, policyId],
  );
  for (const prior of priorResult.rows) {
    const superseded = await client.query(
      `UPDATE erp_fx_accounting_policies
       SET status = 'superseded', superseded_by = $3, superseded_at = NOW(),
           superseded_by_user_id = $4, updated_by = $4, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'approved' AND is_deleted = FALSE
       RETURNING *`,
      [prior.id, companyId, policyId, userId],
    );
    await logAudit({
      companyId,
      userId,
      entityType: "erp_fx_accounting_policies",
      entityId: prior.id,
      action: "supersede",
      oldValues: prior,
      newValues: superseded.rows[0],
      client,
    });
  }
  const result = await client.query(
    `UPDATE erp_fx_accounting_policies
     SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE
     RETURNING *`,
    [policyId, companyId, userId],
  );
  const approved = result.rows[0];
  await logAudit({
    companyId,
    userId,
    entityType: "erp_fx_accounting_policies",
    entityId: policyId,
    action: "approve",
    oldValues: policy,
    newValues: approved,
    client,
  });
  return approved;
}

async function rejectFxAccountingPolicyInTransaction(client, { companyId, userId, policyId, reason }) {
  if (!reason || !String(reason).trim()) throw new Error("A reason is required to reject an FX accounting policy");
  const policy = await getFxPolicyForReview(client, { companyId, policyId });
  assertDifferentUser(policy.created_by, userId);
  const result = await client.query(
    `UPDATE erp_fx_accounting_policies
     SET status = 'rejected', rejected_by = $3, rejected_at = NOW(), decision_reason = $4,
         updated_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE
     RETURNING *`,
    [policyId, companyId, userId, String(reason).trim()],
  );
  const rejected = result.rows[0];
  await logAudit({
    companyId,
    userId,
    entityType: "erp_fx_accounting_policies",
    entityId: policyId,
    action: "reject",
    oldValues: policy,
    newValues: rejected,
    client,
  });
  return rejected;
}

async function getApprovedFxAccountingPolicy(client, { companyId, currencyCode }) {
  const normalizedCurrency = String(currencyCode || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error("Foreign currency must be a three-letter ISO code");
  const result = await client.query(
    `SELECT policy.* FROM erp_fx_accounting_policies policy
     JOIN erp_companies company ON company.id = policy.company_id
       AND company.base_currency_code = policy.base_currency_code
       AND company.is_active = TRUE AND company.is_deleted = FALSE
     WHERE policy.company_id = $1 AND policy.currency_code = $2
       AND policy.status = 'approved' AND policy.is_deleted = FALSE
     ORDER BY policy.approved_at DESC LIMIT 1`,
    [companyId, normalizedCurrency],
  );
  return result.rows[0] || null;
}

module.exports = {
  normalizeFxAccountingPolicy,
  createFxAccountingPolicyInTransaction,
  approveFxAccountingPolicyInTransaction,
  rejectFxAccountingPolicyInTransaction,
  getApprovedFxAccountingPolicy,
};