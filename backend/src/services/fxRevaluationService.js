const pool = require("../db");
const gl = require("./glPostingService");
const fxPolicies = require("./fxAccountingPolicyService");
const exchangeRates = require("./exchangeRateService");
const { logAudit } = require("./auditService");

function calendarDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function postFxPeriodRevaluation({ companyId, userId, periodId, currencyCode, client: suppliedClient = null } = {}) {
  const currency = String(currencyCode || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Choose a valid foreign currency");
  const client = suppliedClient || await pool.connect();
  const ownsTransaction = !suppliedClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      companyId,
      `fx-revaluation:${periodId}:${currency}`,
    ]);
    const periodResult = await client.query(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status
       FROM erp_fiscal_periods WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE`,
      [periodId, companyId],
    );
    const period = periodResult.rows[0];
    if (!period || period.status !== "open") throw new Error("FX revaluation requires an open fiscal period");
    const startDate = calendarDate(period.start_date);
    const endDate = calendarDate(period.end_date);

    const priorRun = await client.query(
      `SELECT id FROM erp_fx_revaluation_runs
       WHERE company_id=$1 AND fiscal_period_id=$2 AND currency_code=$3`,
      [companyId, periodId, currency],
    );
    if (priorRun.rowCount) throw new Error("An FX revaluation already exists for this currency and period");

    const nextPeriodResult = await client.query(
      `SELECT id, start_date::text AS start_date, status FROM erp_fiscal_periods
       WHERE company_id=$1 AND start_date > $2::date AND is_deleted=FALSE
       ORDER BY start_date LIMIT 1 FOR UPDATE`,
      [companyId, endDate],
    );
    const nextPeriod = nextPeriodResult.rows[0];
    if (!nextPeriod || nextPeriod.status !== "open") {
      throw new Error("Open the next fiscal period before posting an FX revaluation with automatic reversal");
    }
    const reversalDate = calendarDate(nextPeriod.start_date);

    const policy = await fxPolicies.getApprovedFxAccountingPolicy(client, { companyId, currencyCode: currency });
    if (!policy) throw new Error(`An independently approved ${currency} accounting policy is required`);
    const rateFromCurrency = policy.rate_direction === "base_per_transaction" ? currency : policy.base_currency_code;
    const rateToCurrency = policy.rate_direction === "base_per_transaction" ? policy.base_currency_code : currency;
    const rate = await exchangeRates.getApprovedExchangeRateForDate(client, {
      companyId,
      fromCurrencyCode: rateFromCurrency,
      toCurrencyCode: rateToCurrency,
      effectiveDate: endDate,
    });
    if (!rate || rate.accounting_policy_id !== policy.id) {
      throw new Error(`An approved ${currency} closing rate matching the active policy is required for ${endDate}`);
    }

    const balancesResult = await client.query(
      `SELECT account.id AS account_id, account.account_type,
              COALESCE(SUM(line.transaction_debit - line.transaction_credit)
                FILTER (WHERE line.currency_code=$3),0)::numeric AS foreign_balance,
              COALESCE(SUM(line.base_debit - line.base_credit),0)::numeric AS carrying_base
       FROM erp_chart_of_accounts account
       LEFT JOIN erp_journals journal ON journal.company_id=account.company_id
         AND journal.status IN ('posted','reversed') AND journal.is_deleted=FALSE
         AND journal.entry_date <= $2::date
       LEFT JOIN erp_journal_lines line ON line.journal_id=journal.id
         AND line.company_id=journal.company_id AND line.account_id=account.id
       WHERE account.company_id=$1 AND account.id=ANY($4::uuid[])
         AND account.is_active=TRUE AND account.is_deleted=FALSE AND account.is_postable=TRUE
       GROUP BY account.id, account.account_type
       HAVING COALESCE(SUM(line.transaction_debit - line.transaction_credit)
         FILTER (WHERE line.currency_code=$3),0) <> 0`,
      [companyId, endDate, currency, policy.monetary_account_ids],
    );
    if (!balancesResult.rowCount) throw new Error(`No posted ${currency} monetary balance is in scope for revaluation`);

    const adjustments = [];
    const snapshots = [];
    for (const row of balancesResult.rows) {
      const signedForeign = Number(row.foreign_balance);
      const signedCarrying = Number(row.carrying_base);
      const exposureSign = row.account_type === "liability" ? -1 : 1;
      const foreignAmount = Math.abs(signedForeign);
      const carryingAmount = Math.abs(signedCarrying);
      const closingAmountRaw = policy.rate_direction === "base_per_transaction"
        ? foreignAmount * Number(rate.rate)
        : foreignAmount / Number(rate.rate);
      const closingAmount = Math.round(closingAmountRaw * 100) / 100;
      const varianceMagnitude = Math.round((closingAmount - carryingAmount) * 100) / 100;
      const signedVariance = varianceMagnitude * exposureSign;
      const gainAmount = Math.max(0, signedVariance);
      const lossAmount = Math.max(0, -signedVariance);
      snapshots.push({
        account_id: row.account_id,
        foreign_balance: signedForeign,
        carrying_base_amount: carryingAmount,
        closing_base_amount: closingAmount,
        variance_base_amount: signedVariance,
        gain_amount: gainAmount,
        loss_amount: lossAmount,
      });
      if (Math.abs(signedVariance) < 0.005) continue;
      const monetaryDebit = signedVariance > 0;
      adjustments.push({
        account_id: row.account_id,
        debit: monetaryDebit ? Math.abs(signedVariance) : 0,
        credit: monetaryDebit ? 0 : Math.abs(signedVariance),
        description: `${currency} period-end revaluation`,
      });
      if (gainAmount > 0) {
        adjustments.push({
          account_id: policy.unrealized_gain_account_id,
          debit: monetaryDebit ? 0 : gainAmount,
          credit: monetaryDebit ? gainAmount : 0,
          description: `${currency} unrealized exchange gain`,
        });
      } else {
        adjustments.push({
          account_id: policy.unrealized_loss_account_id,
          debit: monetaryDebit ? 0 : lossAmount,
          credit: monetaryDebit ? lossAmount : 0,
          description: `${currency} unrealized exchange loss`,
        });
      }
    }

    let journalId = null;
    let reversalJournalId = null;
    if (adjustments.length) {
      const journal = await gl.createJournalInTransaction(client, {
        companyId,
        userId,
        entryDate: endDate,
        journalType: "adjustment",
        referenceNo: `FX-REVAL-${currency}-${endDate}`,
        description: `${currency} closing revaluation for ${period.name}`,
        currencyCode: policy.base_currency_code,
        source: "fx_period_revaluation",
        lines: adjustments,
      });
      await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
      journalId = journal.id;

      const reversalLines = adjustments.map((line) => ({
        account_id: line.account_id,
        debit: line.credit,
        credit: line.debit,
        description: `Automatic reversal: ${line.description}`,
      }));
      const reversal = await gl.createJournalInTransaction(client, {
        companyId,
        userId,
        entryDate: reversalDate,
        journalType: "adjustment",
        referenceNo: `FX-REVERSAL-${currency}-${endDate}`,
        description: `Automatic reversal of ${currency} closing revaluation for ${period.name}`,
        currencyCode: policy.base_currency_code,
        source: "fx_revaluation_reversal",
        reversalOfId: journal.id,
        lines: reversalLines,
      });
      await gl.postJournalInTransaction(client, { journalId: reversal.id, companyId, userId });
      reversalJournalId = reversal.id;
    }

    const totalGain = Math.round(snapshots.reduce((sum, line) => sum + line.gain_amount, 0) * 100) / 100;
    const totalLoss = Math.round(snapshots.reduce((sum, line) => sum + line.loss_amount, 0) * 100) / 100;
    const runResult = await client.query(
      `INSERT INTO erp_fx_revaluation_runs (
         company_id, fiscal_period_id, currency_code, accounting_policy_id,
         exchange_rate_id, closing_rate, journal_id, reversal_journal_id,
         total_gain, total_loss, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [companyId, periodId, currency, policy.id, rate.id, rate.rate, journalId,
        reversalJournalId, totalGain, totalLoss, userId],
    );
    for (const line of snapshots) {
      await client.query(
        `INSERT INTO erp_fx_revaluation_run_lines (
           company_id, run_id, account_id, foreign_balance, carrying_base_amount,
           closing_base_amount, variance_base_amount, gain_amount, loss_amount
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, runResult.rows[0].id, line.account_id, line.foreign_balance,
          line.carrying_base_amount, line.closing_base_amount, line.variance_base_amount,
          line.gain_amount, line.loss_amount],
      );
    }
    await logAudit({
      companyId,
      userId,
      entityType: "erp_fx_revaluation_runs",
      entityId: runResult.rows[0].id,
      action: "post",
      newValues: { run: runResult.rows[0], snapshots },
      client,
    });
    if (ownsTransaction) await client.query("COMMIT");
    return { run: runResult.rows[0], lines: snapshots };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

async function listFxRevaluationRuns(companyId) {
  const result = await pool.query(
    `SELECT run.id, run.fiscal_period_id, period.name AS period_name,
            run.currency_code, run.closing_rate, run.total_gain, run.total_loss,
            run.journal_id, run.reversal_journal_id, run.status, run.created_at,
            COUNT(line.id)::int AS account_count
     FROM erp_fx_revaluation_runs run
     JOIN erp_fiscal_periods period ON period.id=run.fiscal_period_id AND period.company_id=run.company_id
     LEFT JOIN erp_fx_revaluation_run_lines line ON line.run_id=run.id AND line.company_id=run.company_id
     WHERE run.company_id=$1 GROUP BY run.id, period.name
     ORDER BY period.start_date DESC, run.currency_code`,
    [companyId],
  );
  return result.rows;
}

module.exports = { postFxPeriodRevaluation, listFxRevaluationRuns };