const { assertDifferentUser, logAudit } = require("./auditService");

function normalizeExchangeRate({ fromCurrencyCode, toCurrencyCode, rate, effectiveDate, source }) {
  const from = String(fromCurrencyCode || "").trim().toUpperCase();
  const to = String(toCurrencyCode || "").trim().toUpperCase();
  const numericRate = Number(rate);
  const date = String(effectiveDate || "").trim();
  const rateSource = String(source || "").trim();
  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) {
    throw new Error("Exchange rate requires two different three-letter currency codes");
  }
  if (!Number.isFinite(numericRate) || numericRate <= 0) {
    throw new Error("Exchange rate must be a positive number");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("Exchange rate effective date must be a valid YYYY-MM-DD date");
  }
  if (!rateSource) throw new Error("Exchange rate source is required");

  return { from, to, rate: numericRate, effectiveDate: date, source: rateSource };
}

async function createExchangeRateInTransaction(client, {
  companyId, userId, fromCurrencyCode, toCurrencyCode, rate, effectiveDate, source,
}) {
  const normalized = normalizeExchangeRate({ fromCurrencyCode, toCurrencyCode, rate, effectiveDate, source });
  const currencies = await client.query(
    "SELECT code FROM erp_currencies WHERE code = ANY($1::char(3)[]) AND is_active = TRUE",
    [[normalized.from, normalized.to]],
  );
  if (currencies.rowCount !== 2) throw new Error("Exchange rate currencies must both be active in the currency registry");
  const result = await client.query(
    `INSERT INTO erp_exchange_rates (
       company_id, from_currency_code, to_currency_code, rate, effective_date, source, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)
     RETURNING *`,
    [companyId, normalized.from, normalized.to, normalized.rate,
      normalized.effectiveDate, normalized.source, userId],
  );
  const exchangeRate = result.rows[0];
  await logAudit({
    companyId,
    userId,
    entityType: "erp_exchange_rates",
    entityId: exchangeRate.id,
    action: "create_draft",
    newValues: exchangeRate,
    client,
  });
  return exchangeRate;
}

async function getApprovedExchangeRateForDate(client, {
  companyId, fromCurrencyCode, toCurrencyCode, effectiveDate,
}) {
  const normalized = normalizeExchangeRate({
    fromCurrencyCode,
    toCurrencyCode,
    rate: 1,
    effectiveDate,
    source: "lookup",
  });
  const result = await client.query(
    `SELECT rate.*, policy.id AS accounting_policy_id, policy.rate_direction
     FROM erp_exchange_rates rate
     JOIN erp_fx_accounting_policies policy ON policy.company_id = rate.company_id
       AND policy.status = 'approved' AND policy.is_deleted = FALSE
       AND policy.rate_source = rate.source
       AND ((policy.rate_direction = 'base_per_transaction'
             AND policy.currency_code = rate.from_currency_code
             AND policy.base_currency_code = rate.to_currency_code)
         OR (policy.rate_direction = 'transaction_per_base'
             AND policy.base_currency_code = rate.from_currency_code
             AND policy.currency_code = rate.to_currency_code))
     JOIN erp_companies company ON company.id = rate.company_id
       AND company.base_currency_code = policy.base_currency_code
       AND company.is_active = TRUE AND company.is_deleted = FALSE
     WHERE rate.company_id = $1 AND rate.from_currency_code = $2 AND rate.to_currency_code = $3
       AND rate.effective_date = $4 AND rate.status = 'approved' AND rate.is_deleted = FALSE
     ORDER BY rate.approved_at DESC LIMIT 1`,
    [companyId, normalized.from, normalized.to, normalized.effectiveDate],
  );
  return result.rows[0] || null;
}

async function getDraftExchangeRate(client, { companyId, exchangeRateId }) {
  const result = await client.query(
    `SELECT * FROM erp_exchange_rates
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
     FOR UPDATE`,
    [exchangeRateId, companyId],
  );
  const exchangeRate = result.rows[0];
  if (!exchangeRate) {
    const error = new Error("Exchange rate not found");
    error.code = "EXCHANGE_RATE_NOT_FOUND";
    throw error;
  }
  if (exchangeRate.status !== "draft") {
    const error = new Error("Only a draft exchange rate can be reviewed");
    error.code = "EXCHANGE_RATE_INVALID_STATE";
    throw error;
  }
  return exchangeRate;
}

async function approveExchangeRateInTransaction(client, { companyId, userId, exchangeRateId }) {
  const exchangeRate = await getDraftExchangeRate(client, { companyId, exchangeRateId });
  assertDifferentUser(exchangeRate.created_by, userId);
  const result = await client.query(
    `UPDATE erp_exchange_rates
     SET status = 'approved', approved_by = $3, approved_at = NOW(), rejected_by = NULL,
         rejected_at = NULL, decision_reason = NULL, updated_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE
     RETURNING *`,
    [exchangeRateId, companyId, userId],
  );
  const approved = result.rows[0];
  await logAudit({
    companyId,
    userId,
    entityType: "erp_exchange_rates",
    entityId: exchangeRateId,
    action: "approve",
    oldValues: exchangeRate,
    newValues: approved,
    client,
  });
  return approved;
}

async function rejectExchangeRateInTransaction(client, {
  companyId, userId, exchangeRateId, reason,
}) {
  if (!reason || !String(reason).trim()) throw new Error("A reason is required to reject an exchange rate");
  const exchangeRate = await getDraftExchangeRate(client, { companyId, exchangeRateId });
  assertDifferentUser(exchangeRate.created_by, userId);
  const result = await client.query(
    `UPDATE erp_exchange_rates
     SET status = 'rejected', rejected_by = $3, rejected_at = NOW(), decision_reason = $4,
         updated_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE
     RETURNING *`,
    [exchangeRateId, companyId, userId, String(reason).trim()],
  );
  const rejected = result.rows[0];
  await logAudit({
    companyId,
    userId,
    entityType: "erp_exchange_rates",
    entityId: exchangeRateId,
    action: "reject",
    oldValues: exchangeRate,
    newValues: rejected,
    client,
  });
  return rejected;
}

module.exports = {
  normalizeExchangeRate,
  createExchangeRateInTransaction,
  getApprovedExchangeRateForDate,
  approveExchangeRateInTransaction,
  rejectExchangeRateInTransaction,
};