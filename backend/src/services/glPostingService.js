const pool = require("../db");
const { nextDocumentNo } = require("./documentNumberingService");
const { toMinorUnits } = require("../lib/money");
const { assertDifferentUser } = require("./auditService");

async function nextJournalNo(client, companyId) {
  return nextDocumentNo(client, { companyId, docType: "erp_journals", prefix: "JE" });
}

async function getOpenPeriod(client, companyId, entryDate) {
  const result = await client.query(
    `SELECT fp.* FROM erp_fiscal_periods fp
     WHERE fp.company_id = $1 AND fp.status = 'open' AND fp.is_deleted = FALSE
       AND $2::date BETWEEN fp.start_date AND fp.end_date
     ORDER BY fp.period_no LIMIT 1 FOR UPDATE`,
    [companyId, entryDate],
  );
  return result.rows[0] || null;
}

function validateLinesBalanced(lines) {
  for (const line of lines) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0)) {
      throw new Error("Journal line amounts must be non-negative and use either debit or credit, not both");
    }
  }
  const debitMinor = lines.reduce((sum, line) => sum + toMinorUnits(line.debit || 0), 0n);
  const creditMinor = lines.reduce((sum, line) => sum + toMinorUnits(line.credit || 0), 0n);
  const totalDebit = Number(debitMinor) / 100;
  const totalCredit = Number(creditMinor) / 100;
  if (debitMinor !== creditMinor) throw new Error(`Journal not balanced: debit ${totalDebit} != credit ${totalCredit}`);
  if (totalDebit <= 0) throw new Error("Journal totals must be greater than zero");
  return { totalDebit, totalCredit };
}

function convertToBaseCurrencyAmount({
  amount, currencyCode, baseCurrencyCode, exchangeRate,
  rateDirection = "base_per_transaction", baseCurrencyDecimalPlaces = 2,
}) {
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw new Error("Foreign-currency amounts must be non-negative numbers");
  }
  const fromCurrency = String(currencyCode || "").trim().toUpperCase();
  const toCurrency = String(baseCurrencyCode || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency)) {
    throw new Error("Currency codes must be three-letter ISO values");
  }
  const rate = Number(exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Exchange rate must be a positive number");
  }
  if (!["base_per_transaction", "transaction_per_base"].includes(rateDirection)) {
    throw new Error("Exchange-rate direction must be base_per_transaction or transaction_per_base");
  }
  if (!Number.isInteger(baseCurrencyDecimalPlaces) || baseCurrencyDecimalPlaces < 0 || baseCurrencyDecimalPlaces > 6) {
    throw new Error("Base currency decimal places must be an integer from zero to six");
  }
  if (fromCurrency === toCurrency) {
    return numericAmount;
  }
  const converted = rateDirection === "base_per_transaction"
    ? numericAmount * rate
    : numericAmount / rate;
  const precision = 10 ** baseCurrencyDecimalPlaces;
  return Math.round((converted + Number.EPSILON) * precision) / precision;
}

function buildJournalLineCurrencySnapshot({
  debit, credit, currencyCode, baseCurrencyCode, exchangeRate, entryDate,
  rateDirection = "base_per_transaction", baseCurrencyDecimalPlaces = 2,
  exchangeRateSource = null, exchangeRateId = null, allowForeignCurrency = false,
}) {
  const normalizedCurrency = String(currencyCode || "").trim().toUpperCase();
  const normalizedBaseCurrency = String(baseCurrencyCode || "").trim().toUpperCase();
  const rate = Number(exchangeRate);
  const debitAmount = Number(debit || 0);
  const creditAmount = Number(credit || 0);
  const effectiveDate = entryDate instanceof Date
    ? entryDate.toISOString().slice(0, 10)
    : String(entryDate || "").slice(0, 10);

  if (!/^[A-Z]{3}$/.test(normalizedCurrency) || !/^[A-Z]{3}$/.test(normalizedBaseCurrency)) {
    throw new Error("Currency codes must be three-letter ISO values");
  }
  const isForeignCurrency = normalizedCurrency !== normalizedBaseCurrency;
  if (isForeignCurrency && !allowForeignCurrency) {
    const error = new Error("Foreign-currency journal lines remain unsupported until the complete accounting workflow is implemented");
    error.code = "FOREIGN_CURRENCY_UNSUPPORTED";
    throw error;
  }
  if (!isForeignCurrency && rate !== 1) throw new Error("Base-currency journal lines must use an exchange rate of 1");
  if (!Number.isFinite(debitAmount) || !Number.isFinite(creditAmount)
    || debitAmount < 0 || creditAmount < 0 || (debitAmount > 0 && creditAmount > 0)) {
    throw new Error("Journal line amounts must be non-negative and use either debit or credit, not both");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) {
    throw new Error("Journal entry date is required for the currency snapshot");
  }

  const convert = (amount) => isForeignCurrency
    ? convertToBaseCurrencyAmount({
      amount,
      currencyCode: normalizedCurrency,
      baseCurrencyCode: normalizedBaseCurrency,
      exchangeRate: rate,
      rateDirection,
      baseCurrencyDecimalPlaces,
    })
    : amount;

  return {
    transaction_debit: debitAmount,
    transaction_credit: creditAmount,
    base_debit: convert(debitAmount),
    base_credit: convert(creditAmount),
    exchange_rate: rate,
    exchange_rate_source: isForeignCurrency ? exchangeRateSource : "base_currency",
    exchange_rate_direction: isForeignCurrency ? rateDirection : "base_per_transaction",
    exchange_rate_id: isForeignCurrency ? exchangeRateId : null,
    exchange_rate_effective_date: effectiveDate,
  };
}

function calculateProfitLoss(lines) {
  const income = lines.filter((line) => line.account_type === "income")
    .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0);
  const expense = lines.filter((line) => line.account_type === "expense")
    .reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0);
  return { income, expense, net_profit: income - expense };
}

async function createJournalInTransaction(client, {
  companyId, userId, entryDate, journalType = "general", referenceNo, description,
  lines, branchId, currencyCode, exchangeRate = null, source = null, reversalOfId = null,
}) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("At least two journal lines required");
  validateLinesBalanced(lines);
  const companyCurrency = await client.query(
    `SELECT company.base_currency_code, currency.decimal_places AS base_currency_decimal_places
     FROM erp_companies company
     JOIN erp_currencies currency ON currency.code = company.base_currency_code
     WHERE company.id = $1 AND company.is_active = TRUE AND company.is_deleted = FALSE`,
    [companyId],
  );
  if (!companyCurrency.rowCount) throw new Error("Company not found");
  const baseCurrencyCode = String(companyCurrency.rows[0].base_currency_code).trim().toUpperCase();
  const normalizedCurrency = String(currencyCode || baseCurrencyCode).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error("Journal currency must be a three-letter ISO code");
  const isForeignCurrency = normalizedCurrency !== baseCurrencyCode;
  const effectiveDate = entryDate instanceof Date
    ? entryDate.toISOString().slice(0, 10)
    : String(entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let resolvedExchangeRate = Number(exchangeRate ?? 1);
  let exchangeRateSource = "base_currency";
  let exchangeRateId = null;
  let rateDirection = "base_per_transaction";
  let approvedPolicy = null;

  if (isForeignCurrency) {
    const fxPolicies = require("./fxAccountingPolicyService");
    const rateService = require("./exchangeRateService");
    approvedPolicy = await fxPolicies.getApprovedFxAccountingPolicy(client, {
      companyId,
      currencyCode: normalizedCurrency,
    });
    if (!approvedPolicy) {
      const error = new Error(`Foreign-currency posting requires an approved ${normalizedCurrency} accounting policy`);
      error.code = "FX_POLICY_REQUIRED";
      throw error;
    }
    rateDirection = approvedPolicy.rate_direction;
    const rateFromCurrency = rateDirection === "base_per_transaction" ? normalizedCurrency : baseCurrencyCode;
    const rateToCurrency = rateDirection === "base_per_transaction" ? baseCurrencyCode : normalizedCurrency;
    const approvedRate = await rateService.getApprovedExchangeRateForDate(client, {
      companyId,
      fromCurrencyCode: rateFromCurrency,
      toCurrencyCode: rateToCurrency,
      effectiveDate,
    });
    if (!approvedRate || approvedRate.accounting_policy_id !== approvedPolicy.id) {
      const error = new Error(`No approved ${normalizedCurrency} exchange rate matches the active policy for ${effectiveDate}`);
      error.code = "FX_RATE_REQUIRED";
      throw error;
    }
    if (exchangeRate !== null && exchangeRate !== undefined
      && Math.abs(Number(exchangeRate) - Number(approvedRate.rate)) > 1e-8) {
      throw new Error("Supplied exchange rate does not match the independently approved effective-date rate");
    }
    resolvedExchangeRate = Number(approvedRate.rate);
    exchangeRateSource = approvedRate.source;
    exchangeRateId = approvedRate.id;
  } else if (exchangeRate !== null && exchangeRate !== undefined && Number(exchangeRate) !== 1) {
    throw new Error("Base-currency journals must use an exchange rate of 1");
  }

  const accountIds = [...new Set(lines.map((line) => line.account_id))];
  if (accountIds.some((id) => !id)) throw new Error("Every journal line must select an account");
  const accounts = await client.query(
    `SELECT id, account_code, account_type, currency_code FROM erp_chart_of_accounts
     WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE
       AND is_deleted = FALSE AND is_postable = TRUE`,
    [companyId, accountIds],
  );
  if (accounts.rowCount !== accountIds.length) throw new Error("Journal lines must use active, postable accounts from this company");
  if (isForeignCurrency) {
    const monetaryAccountIds = new Set(approvedPolicy.monetary_account_ids.map(String));
    if (accounts.rows.some((account) => !monetaryAccountIds.has(String(account.id))
      || String(account.currency_code || "").trim().toUpperCase() !== normalizedCurrency)) {
      throw new Error("Foreign-currency journals may only post to accounts denominated in and scoped by the approved FX policy");
    }
  }
  const accountById = new Map(accounts.rows.map((account) => [String(account.id), account]));
  const currencySnapshots = lines.map((line) => {
    const account = accountById.get(String(line.account_id));
    return buildJournalLineCurrencySnapshot({
      debit: line.debit,
      credit: line.credit,
      currencyCode: normalizedCurrency,
      baseCurrencyCode,
      exchangeRate: resolvedExchangeRate,
      entryDate: effectiveDate,
      rateDirection,
      baseCurrencyDecimalPlaces: Number(companyCurrency.rows[0].base_currency_decimal_places),
      exchangeRateSource,
      exchangeRateId,
      allowForeignCurrency: isForeignCurrency && approvedPolicy.monetary_account_ids.map(String).includes(String(account.id)),
    });
  });
  const { totalDebit, totalCredit } = validateLinesBalanced(currencySnapshots.map((snapshot) => ({
    debit: snapshot.base_debit,
    credit: snapshot.base_credit,
  })));
  if (branchId) {
    const branch = await client.query(
      "SELECT id FROM erp_branches WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE",
      [branchId, companyId],
    );
    if (!branch.rowCount) throw new Error("Journal branch must be active and belong to this company");
  }
  const period = await getOpenPeriod(client, companyId, entryDate || new Date());
  if (!period) throw new Error("No open fiscal period for entry date");
  const journalNo = await nextJournalNo(client, companyId);
  const result = await client.query(
    `INSERT INTO erp_journals (
       company_id, fiscal_period_id, branch_id, journal_no, journal_type, entry_date,
       reference_no, description, currency_code, exchange_rate, status, source_type,
       total_debit, total_credit, created_by, reversal_of_id
     ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,'draft',$11,$12,$13,$14,$15)
     RETURNING *`,
    [companyId, period.id, branchId || null, journalNo, journalType, entryDate || null,
      referenceNo || null, description || null, normalizedCurrency, resolvedExchangeRate,
      source || (journalType === "general" ? "manual" : "module"), totalDebit, totalCredit, userId, reversalOfId],
  );
  const journal = result.rows[0];
  for (const [index, line] of lines.entries()) {
    const currencySnapshot = currencySnapshots[index];
    await client.query(
      `INSERT INTO erp_journal_lines (
         company_id, journal_id, line_no, account_id, description,
         debit, credit, currency_code, amount_foreign,
         transaction_debit, transaction_credit, base_debit, base_credit,
         exchange_rate, exchange_rate_source, exchange_rate_direction, exchange_rate_id,
         exchange_rate_effective_date,
         cost_centre, department, project_code
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [companyId, journal.id, index + 1, line.account_id, line.description || description || null,
        currencySnapshot.base_debit, currencySnapshot.base_credit, normalizedCurrency,
        currencySnapshot.transaction_debit - currencySnapshot.transaction_credit,
        currencySnapshot.transaction_debit, currencySnapshot.transaction_credit,
        currencySnapshot.base_debit, currencySnapshot.base_credit,
        currencySnapshot.exchange_rate, currencySnapshot.exchange_rate_source,
        currencySnapshot.exchange_rate_direction, currencySnapshot.exchange_rate_id,
        currencySnapshot.exchange_rate_effective_date,
        line.cost_centre || null, line.department || null, line.project_code || null],
    );
  }
  return journal;
}

async function postJournalInTransaction(client, { journalId, companyId, userId }) {
  const journalResult = await client.query(
    `SELECT j.* FROM erp_journals j
     WHERE j.id = $1 AND j.company_id = $2 AND j.is_deleted = FALSE FOR UPDATE`,
    [journalId, companyId],
  );
  const journal = journalResult.rows[0];
  if (!journal) throw new Error("Journal not found");
  if (journal.status !== "draft") throw new Error("Only a draft journal can be posted");
  if (journal.journal_type === "general" && journal.source_type === "manual") {
    const setting = await client.query(
      `SELECT setting_value FROM erp_system_settings
       WHERE company_id = $1 AND category = 'finance' AND setting_key = 'manual_journal_maker_checker'`,
      [companyId],
    );
    const makerChecker = setting.rowCount === 0 || setting.rows[0].setting_value === true || setting.rows[0].setting_value === "true";
    if (makerChecker) assertDifferentUser(journal.created_by, userId);
  }
  const period = await client.query(
    "SELECT status FROM erp_fiscal_periods WHERE id = $1 AND company_id = $2 FOR UPDATE",
    [journal.fiscal_period_id, companyId],
  );
  if (!period.rowCount || period.rows[0].status !== "open") throw new Error("Fiscal period is not open");
  const lines = await client.query(
    `SELECT jl.*, a.is_postable, a.account_code
     FROM erp_journal_lines jl JOIN erp_chart_of_accounts a ON a.id = jl.account_id
     WHERE jl.journal_id = $1 AND jl.company_id = $2 AND a.company_id = $2
       AND a.is_active = TRUE AND a.is_deleted = FALSE ORDER BY jl.line_no`,
    [journalId, companyId],
  );
  validateLinesBalanced(lines.rows);
  if (lines.rows.some((line) => !line.is_postable)) {
    const invalid = lines.rows.find((line) => !line.is_postable);
    throw new Error(`Account ${invalid.account_code} is not postable`);
  }
  await client.query(
    `UPDATE erp_journals SET status = 'posted', posted_at = NOW(), posted_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [journalId, companyId, userId],
  );
  await rebuildGlBalances(client, companyId, userId);
  return { ok: true, journal_id: journalId };
}

async function rebuildGlBalances(client, companyId, userId = null) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [companyId,"gl-balance-rebuild"]);
  const periodsResult = await client.query(
    `SELECT id, fiscal_year_id, start_date FROM erp_fiscal_periods
     WHERE company_id = $1 AND is_deleted = FALSE ORDER BY start_date, period_no`, [companyId]);
  const accountsResult = await client.query(
    `SELECT id, account_type FROM erp_chart_of_accounts
     WHERE company_id = $1 AND is_deleted = FALSE`, [companyId]);
  const movementsResult = await client.query(
    `SELECT j.fiscal_period_id, jl.account_id, SUM(jl.debit)::numeric AS debit,
            SUM(jl.credit)::numeric AS credit
     FROM erp_journals j JOIN erp_journal_lines jl ON jl.journal_id = j.id
     WHERE j.company_id = $1 AND j.status IN ('posted','reversed') AND j.is_deleted = FALSE
     GROUP BY j.fiscal_period_id, jl.account_id`, [companyId]);
  const movements = new Map(movementsResult.rows.map((row) => [`${row.fiscal_period_id}:${row.account_id}`, row]));
  const accounts = new Map(accountsResult.rows.map((row) => [row.id, row.account_type]));
  let priorYear = null;
  let balances = new Map();
  for (const period of periodsResult.rows) {
    if (priorYear !== period.fiscal_year_id) {
      for (const [accountId, type] of accounts) if (type === "income" || type === "expense") balances.set(accountId, { debit: 0, credit: 0 });
      priorYear = period.fiscal_year_id;
    }
    for (const [accountId, type] of accounts) {
      const opening = balances.get(accountId) || { debit: 0, credit: 0 };
      const movement = movements.get(`${period.id}:${accountId}`) || { debit: 0, credit: 0 };
      const periodDebit = Number(movement.debit || 0);
      const periodCredit = Number(movement.credit || 0);
      const net = opening.debit - opening.credit + periodDebit - periodCredit;
      const closing = net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net };
      await client.query(
        `INSERT INTO erp_gl_balances(company_id,fiscal_period_id,account_id,opening_debit,opening_credit,
           period_debit,period_credit,closing_debit,closing_credit,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT(fiscal_period_id,account_id) DO UPDATE SET opening_debit=EXCLUDED.opening_debit,
           opening_credit=EXCLUDED.opening_credit,period_debit=EXCLUDED.period_debit,
           period_credit=EXCLUDED.period_credit,closing_debit=EXCLUDED.closing_debit,
           closing_credit=EXCLUDED.closing_credit,updated_by=EXCLUDED.updated_by,updated_at=NOW(),is_deleted=FALSE`,
        [companyId,period.id,accountId,opening.debit,opening.credit,periodDebit,periodCredit,closing.debit,closing.credit,userId]);
      balances.set(accountId, closing);
    }
  }
  return { periods: periodsResult.rowCount, accounts: accountsResult.rowCount };
}

async function createJournal(options) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const journal = await createJournalInTransaction(client, options);
    await client.query("COMMIT");
    return journal;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function postJournal(options) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await postJournalInTransaction(client, options);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function getTrialBalance(companyId, fiscalPeriodId) {
  const result = await pool.query(
    `SELECT a.account_code, a.account_name, a.account_type,
            b.opening_debit, b.opening_credit, b.period_debit, b.period_credit,
            b.closing_debit, b.closing_credit
     FROM erp_gl_balances b JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2 AND b.is_deleted = FALSE
     ORDER BY a.account_code`,
    [companyId, fiscalPeriodId],
  );
  return result.rows;
}

module.exports = {
  createJournal, createJournalInTransaction, postJournal, postJournalInTransaction,
  getTrialBalance, validateLinesBalanced, nextJournalNo,
  rebuildGlBalances,
  calculateProfitLoss,
  convertToBaseCurrencyAmount,
  buildJournalLineCurrencySnapshot,
};
