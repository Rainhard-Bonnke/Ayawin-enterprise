const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const exchangeRates = require("../../services/exchangeRateService");
const fxPolicies = require("../../services/fxAccountingPolicyService");
const fxRevaluations = require("../../services/fxRevaluationService");

const router = express.Router();
router.use(authenticateErp);

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sendExchangeRateError(res, error) {
  const status = error.code === "23505" ? 409
    : error.code === "EXCHANGE_RATE_NOT_FOUND" ? 404
      : error.code === "EXCHANGE_RATE_INVALID_STATE" ? 409 : 400;
  const message = error.code === "23505"
    ? "An exchange rate already exists for this currency pair and effective date"
    : error.message;
  return res.status(status).json({ error: message });
}

function sendFxPolicyError(res, error) {
  const status = error.code === "23505" ? 409
    : error.code === "FX_POLICY_NOT_FOUND" ? 404
      : error.code === "FX_POLICY_INVALID_STATE" ? 409 : 400;
  const message = error.code === "23505"
    ? "An active FX policy already exists for this currency"
    : error.message;
  return res.status(status).json({ error: message });
}

router.get("/", requirePermission("foundation.view"), async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM erp_currencies WHERE is_active = TRUE ORDER BY code",
  );
  return res.json(result.rows);
});

router.get("/exchange-rates", requirePermission("foundation.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_exchange_rates
     WHERE company_id = $1 AND is_deleted = FALSE
     ORDER BY effective_date DESC, from_currency_code`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/exchange-rates", requirePermission("foundation.edit"), async (req, res) => {
  const { from_currency_code, to_currency_code, rate, effective_date, source } = req.body || {};
  try {
    const result = await inTransaction((client) => exchangeRates.createExchangeRateInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      fromCurrencyCode: from_currency_code,
      toCurrencyCode: to_currency_code,
      rate,
      effectiveDate: effective_date,
      source,
    }));
    return res.status(201).json(result);
  } catch (error) {
    return sendExchangeRateError(res, error);
  }
});

router.post("/exchange-rates/:id/approve", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await inTransaction((client) => exchangeRates.approveExchangeRateInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      exchangeRateId: req.params.id,
    }));
    return res.json(result);
  } catch (error) {
    return sendExchangeRateError(res, error);
  }
});

router.post("/exchange-rates/:id/reject", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await inTransaction((client) => exchangeRates.rejectExchangeRateInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      exchangeRateId: req.params.id,
      reason: req.body?.reason,
    }));
    return res.json(result);
  } catch (error) {
    return sendExchangeRateError(res, error);
  }
});

router.get("/fx-accounting-policies", requirePermission("finance.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT policy.*, gain.account_code AS realized_gain_account_code,
            loss.account_code AS realized_loss_account_code
     FROM erp_fx_accounting_policies policy
     JOIN erp_chart_of_accounts gain ON gain.id = policy.realized_gain_account_id
     JOIN erp_chart_of_accounts loss ON loss.id = policy.realized_loss_account_id
     WHERE policy.company_id = $1 AND policy.is_deleted = FALSE
     ORDER BY policy.currency_code, policy.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/fx-accounting-policies", requirePermission("finance.create"), async (req, res) => {
  const body = req.body || {};
  try {
    const result = await inTransaction((client) => fxPolicies.createFxAccountingPolicyInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      currencyCode: body.currency_code,
      rateDirection: body.rate_direction,
      rateSource: body.rate_source,
      effectiveDatePolicy: body.effective_date_policy,
      roundingMethod: body.rounding_method,
      realizedGainAccountId: body.realized_gain_account_id,
      realizedLossAccountId: body.realized_loss_account_id,
      unrealizedGainAccountId: body.unrealized_gain_account_id,
      unrealizedLossAccountId: body.unrealized_loss_account_id,
      monetaryAccountIds: body.monetary_account_ids,
      reversalPolicy: body.reversal_policy,
    }));
    return res.status(201).json(result);
  } catch (error) {
    return sendFxPolicyError(res, error);
  }
});

router.post("/fx-accounting-policies/:id/approve", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await inTransaction((client) => fxPolicies.approveFxAccountingPolicyInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      policyId: req.params.id,
    }));
    return res.json(result);
  } catch (error) {
    return sendFxPolicyError(res, error);
  }
});

router.post("/fx-accounting-policies/:id/reject", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await inTransaction((client) => fxPolicies.rejectFxAccountingPolicyInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      policyId: req.params.id,
      reason: req.body?.reason,
    }));
    return res.json(result);
  } catch (error) {
    return sendFxPolicyError(res, error);
  }
});

router.get("/fx-revaluations", requirePermission("finance.view"), async (req, res) => {
  try {
    return res.json(await fxRevaluations.listFxRevaluationRuns(req.user.company_id));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list FX revaluation runs" });
  }
});

router.post("/fx-revaluations", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await fxRevaluations.postFxPeriodRevaluation({
      companyId: req.user.company_id,
      userId: req.user.id,
      periodId: req.body?.period_id,
      currencyCode: req.body?.currency_code,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to post FX revaluation" });
  }
});

module.exports = router;
