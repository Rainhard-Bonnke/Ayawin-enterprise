const pool = require("../db");
const { nextDocumentNo } = require("./documentNumberingService");
const { toMinorUnits } = require("../lib/money");

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

function calculateProfitLoss(lines) {
  const income = lines.filter((line) => line.account_type === "income")
    .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0);
  const expense = lines.filter((line) => line.account_type === "expense")
    .reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0);
  return { income, expense, net_profit: income - expense };
}

async function createJournalInTransaction(client, {
  companyId, userId, entryDate, journalType = "general", referenceNo, description,
  lines, branchId, currencyCode, exchangeRate = 1, source = null, reversalOfId = null,
}) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("At least two journal lines required");
  const { totalDebit, totalCredit } = validateLinesBalanced(lines);
  const companyCurrency = await client.query("SELECT base_currency_code FROM erp_companies WHERE id = $1", [companyId]);
  if (!companyCurrency.rowCount) throw new Error("Company not found");
  const normalizedCurrency = String(currencyCode || companyCurrency.rows[0].base_currency_code).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency) || !Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0) {
    throw new Error("Journal currency must be a three-letter code with a positive exchange rate");
  }
  if (normalizedCurrency !== companyCurrency.rows[0].base_currency_code) {
    // TODO(Phase 2): convert foreign journal amounts into the company base currency.
    const error = new Error("Foreign-currency journals are not supported until base-currency conversion is implemented (Phase 2)");
    error.code = "FOREIGN_CURRENCY_UNSUPPORTED";
    throw error;
  }
  if (Number(exchangeRate) !== 1) throw new Error("Base-currency journals must use an exchange rate of 1");
  const accountIds = [...new Set(lines.map((line) => line.account_id))];
  if (accountIds.some((id) => !id)) throw new Error("Every journal line must select an account");
  const accounts = await client.query(
    `SELECT id, account_code FROM erp_chart_of_accounts
     WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE
       AND is_deleted = FALSE AND is_postable = TRUE`,
    [companyId, accountIds],
  );
  if (accounts.rowCount !== accountIds.length) throw new Error("Journal lines must use active, postable accounts from this company");
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
      referenceNo || null, description || null, normalizedCurrency, exchangeRate,
      source || (journalType === "general" ? "manual" : "module"), totalDebit, totalCredit, userId, reversalOfId],
  );
  const journal = result.rows[0];
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO erp_journal_lines (
         company_id, journal_id, line_no, account_id, description,
         debit, credit, currency_code, cost_centre, department, project_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [companyId, journal.id, index + 1, line.account_id, line.description || description || null,
        Number(line.debit || 0), Number(line.credit || 0), normalizedCurrency,
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
  if (journal.journal_type === "general" && journal.source_type === "manual" && journal.created_by === userId) {
    const setting = await client.query(
      `SELECT setting_value FROM erp_system_settings
       WHERE company_id = $1 AND category = 'finance' AND setting_key = 'manual_journal_maker_checker'`,
      [companyId],
    );
    const makerChecker = setting.rowCount === 0 || setting.rows[0].setting_value === true || setting.rows[0].setting_value === "true";
    if (makerChecker) throw new Error("Manual journal creator cannot post their own journal");
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
};
