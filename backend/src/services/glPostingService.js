const pool = require("../db");

async function nextJournalNo(client, companyId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [companyId, "journal-sequence"]);
  const result = await client.query("SELECT COUNT(*)::int AS n FROM erp_journals WHERE company_id = $1", [companyId]);
  return `JE-${new Date().getFullYear()}-${String(Number(result.rows[0].n) + 1).padStart(4, "0")}`;
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
  const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) throw new Error(`Journal not balanced: debit ${totalDebit} != credit ${totalCredit}`);
  if (totalDebit <= 0) throw new Error("Journal totals must be greater than zero");
  return { totalDebit, totalCredit };
}

async function createJournalInTransaction(client, {
  companyId, userId, entryDate, journalType = "general", referenceNo, description,
  lines, branchId, currencyCode = "KES", exchangeRate = 1,
}) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("At least two journal lines required");
  const { totalDebit, totalCredit } = validateLinesBalanced(lines);
  const normalizedCurrency = String(currencyCode || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency) || !Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0) {
    throw new Error("Journal currency must be a three-letter code with a positive exchange rate");
  }
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
       reference_no, description, currency_code, exchange_rate, status,
       total_debit, total_credit, created_by
     ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,'draft',$11,$12,$13)
     RETURNING *`,
    [companyId, period.id, branchId || null, journalNo, journalType, entryDate || null,
      referenceNo || null, description || null, normalizedCurrency, exchangeRate,
      totalDebit, totalCredit, userId],
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
  for (const line of lines.rows) {
    await client.query(
      `INSERT INTO erp_gl_balances (
         company_id, fiscal_period_id, account_id,
         period_debit, period_credit, closing_debit, closing_credit, created_by
       ) VALUES ($1,$2,$3,$4,$5,$4,$5,$6)
       ON CONFLICT (fiscal_period_id, account_id) DO UPDATE SET
         period_debit = erp_gl_balances.period_debit + EXCLUDED.period_debit,
         period_credit = erp_gl_balances.period_credit + EXCLUDED.period_credit,
         closing_debit = erp_gl_balances.closing_debit + EXCLUDED.period_debit,
         closing_credit = erp_gl_balances.closing_credit + EXCLUDED.period_credit,
         updated_at = NOW(), updated_by = $6`,
      [companyId, journal.fiscal_period_id, line.account_id, line.debit, line.credit, userId],
    );
  }
  await client.query(
    `UPDATE erp_journals SET status = 'posted', posted_at = NOW(), posted_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [journalId, companyId, userId],
  );
  return { ok: true, journal_id: journalId };
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
};
