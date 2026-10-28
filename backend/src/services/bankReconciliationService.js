const pool = require("../db");

function normalizeStatementLine(line, index, startDate, endDate) {
  const date = String(line.transaction_date || "").slice(0, 10);
  const debit = Number(line.debit || 0);
  const credit = Number(line.credit || 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDate || date > endDate) {
    throw new Error(`Statement line ${index + 1} has a date outside the statement period`);
  }
  if (!Number.isFinite(debit) || !Number.isFinite(credit)
    || debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) {
    throw new Error(`Statement line ${index + 1} must have one positive debit or credit amount`);
  }
  const description = String(line.description || "").trim();
  if (!description) throw new Error(`Statement line ${index + 1} needs a description`);
  return {
    lineNo: index + 1,
    transactionDate: date,
    reference: String(line.reference || "").trim() || null,
    description,
    debit: Math.round(debit * 10000) / 10000,
    credit: Math.round(credit * 10000) / 10000,
  };
}

async function createReconciliation({ companyId, userId, bankAccountId, statementReference, statementStart, statementEnd, openingBalance, closingBalance, lines }) {
  if (!statementReference?.trim()) throw new Error("Statement reference is required");
  if (!Array.isArray(lines) || !lines.length || lines.length > 5000) throw new Error("Import between 1 and 5,000 statement lines");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementStart || "")
    || !/^\d{4}-\d{2}-\d{2}$/.test(statementEnd || "") || statementEnd < statementStart) {
    throw new Error("Choose a valid statement date range");
  }
  const opening = Number(openingBalance);
  const closing = Number(closingBalance);
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) throw new Error("Opening and closing balances must be numeric");
  const normalized = lines.map((line, index) => normalizeStatementLine(line, index, statementStart, statementEnd));
  const calculatedClosing = Math.round((opening + normalized.reduce((sum, line) => sum + line.credit - line.debit, 0)) * 100) / 100;
  if (Math.abs(calculatedClosing - closing) > 0.01) {
    throw new Error(`Statement lines calculate to ${calculatedClosing.toFixed(2)}, which does not match the closing balance ${closing.toFixed(2)}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(
      `SELECT id FROM erp_chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND account_type = 'asset' AND account_code LIKE '11%'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE FOR UPDATE`,
      [bankAccountId, companyId],
    );
    if (!account.rowCount) throw new Error("Choose an active postable bank or cash account (account code starting 11)");
    const result = await client.query(
      `INSERT INTO erp_bank_reconciliations
       (company_id, bank_account_id, statement_reference, statement_start, statement_end,
        opening_balance, closing_balance, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [companyId, bankAccountId, statementReference.trim(), statementStart, statementEnd, opening, closing, userId],
    );
    const reconciliation = result.rows[0];
    for (const line of normalized) {
      await client.query(
        `INSERT INTO erp_bank_reconciliation_lines
         (company_id, reconciliation_id, line_no, transaction_date, reference, description, debit, credit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, reconciliation.id, line.lineNo, line.transactionDate, line.reference, line.description, line.debit, line.credit],
      );
    }
    await client.query("COMMIT");
    return reconciliation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listReconciliations(companyId) {
  const result = await pool.query(
    `SELECT r.*, a.account_code, a.account_name, a.currency_code,
            COUNT(l.id)::int AS line_count,
            COUNT(l.journal_line_id)::int AS matched_count
     FROM erp_bank_reconciliations r
     JOIN erp_chart_of_accounts a ON a.id = r.bank_account_id AND a.company_id = r.company_id
     LEFT JOIN erp_bank_reconciliation_lines l ON l.reconciliation_id = r.id AND l.company_id = r.company_id
     WHERE r.company_id = $1
     GROUP BY r.id, a.id ORDER BY r.statement_end DESC, r.created_at DESC`,
    [companyId],
  );
  return result.rows;
}

async function getReconciliation(companyId, reconciliationId) {
  const header = await pool.query(
    `SELECT r.*, a.account_code, a.account_name, a.currency_code
     FROM erp_bank_reconciliations r
     JOIN erp_chart_of_accounts a ON a.id = r.bank_account_id AND a.company_id = r.company_id
     WHERE r.id = $1 AND r.company_id = $2`,
    [reconciliationId, companyId],
  );
  if (!header.rowCount) return null;
  const lines = await pool.query(
    `SELECT l.*, jl.debit AS matched_debit, jl.credit AS matched_credit,
            j.journal_no, j.entry_date AS matched_entry_date, j.reference_no AS journal_reference,
            a.account_code AS matched_account_code
     FROM erp_bank_reconciliation_lines l
     LEFT JOIN erp_journal_lines jl ON jl.id = l.journal_line_id AND jl.company_id = l.company_id
     LEFT JOIN erp_journals j ON j.id = jl.journal_id AND j.company_id = l.company_id
     LEFT JOIN erp_chart_of_accounts a ON a.id = jl.account_id AND a.company_id = l.company_id
     WHERE l.reconciliation_id = $1 AND l.company_id = $2 ORDER BY l.line_no`,
    [reconciliationId, companyId],
  );
  const outstanding = await listCandidates(companyId, reconciliationId);
  return { ...header.rows[0], lines: lines.rows, outstanding_book_lines: outstanding };
}

async function listCandidates(companyId, reconciliationId) {
  const result = await pool.query(
    `SELECT jl.id AS journal_line_id, j.id AS journal_id, j.journal_no, j.entry_date,
            j.reference_no, j.description AS journal_description,
            jl.description AS line_description, jl.debit, jl.credit,
            a.account_code, a.account_name
     FROM erp_bank_reconciliations r
     JOIN erp_journals j ON j.company_id = r.company_id AND j.status = 'posted'
       AND j.is_deleted = FALSE AND j.entry_date BETWEEN r.statement_start - 14 AND r.statement_end + 14
     JOIN erp_journal_lines jl ON jl.journal_id = j.id AND jl.company_id = r.company_id
       AND jl.account_id = r.bank_account_id
     JOIN erp_chart_of_accounts a ON a.id = jl.account_id AND a.company_id = r.company_id
     WHERE r.id = $1 AND r.company_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM erp_bank_reconciliation_lines matched
         WHERE matched.journal_line_id = jl.id
       )
     ORDER BY j.entry_date, j.journal_no, jl.line_no`,
    [reconciliationId, companyId],
  );
  return result.rows;
}

async function matchStatementLine({ companyId, userId, reconciliationId, lineId, journalLineId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reconciliation = await client.query(
      `SELECT * FROM erp_bank_reconciliations WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [reconciliationId, companyId],
    );
    const statementLine = await client.query(
      `SELECT * FROM erp_bank_reconciliation_lines
       WHERE id = $1 AND reconciliation_id = $2 AND company_id = $3 AND journal_line_id IS NULL FOR UPDATE`,
      [lineId, reconciliationId, companyId],
    );
    if (!reconciliation.rowCount || !statementLine.rowCount) throw new Error("Statement or line is not open for matching");
    const bankLine = statementLine.rows[0];
    const source = await client.query(
      `SELECT jl.id, jl.debit, jl.credit, j.entry_date
       FROM erp_journal_lines jl
       JOIN erp_journals j ON j.id = jl.journal_id AND j.company_id = jl.company_id
       WHERE jl.id = $1 AND jl.company_id = $2 AND jl.account_id = $3
         AND j.status = 'posted' AND j.is_deleted = FALSE
         AND j.entry_date BETWEEN $4::date - 14 AND $5::date + 14
         AND NOT EXISTS (SELECT 1 FROM erp_bank_reconciliation_lines x WHERE x.journal_line_id = jl.id)
       FOR UPDATE OF jl`,
      [journalLineId, companyId, reconciliation.rows[0].bank_account_id, bankLine.transaction_date, bankLine.transaction_date],
    );
    const candidate = source.rows[0];
    if (!candidate) throw new Error("That bank transaction is unavailable, already reconciled, or outside the matching date window");
    // Bank statement debit means cash left the bank; in the ERP asset ledger that is a credit.
    const directionMatches = Number(bankLine.debit) > 0
      ? Number(candidate.credit) > 0 && Number(candidate.debit) === 0
      : Number(candidate.debit) > 0 && Number(candidate.credit) === 0;
    const statementAmount = Number(bankLine.debit || bankLine.credit);
    const ledgerAmount = Number(candidate.debit || candidate.credit);
    if (!directionMatches || Math.abs(statementAmount - ledgerAmount) > 0.01) {
      throw new Error("The bank and ledger amounts or directions do not match");
    }
    await client.query(
      `UPDATE erp_bank_reconciliation_lines SET journal_line_id = $4, matched_at = NOW(), matched_by = $5
       WHERE id = $1 AND reconciliation_id = $2 AND company_id = $3`,
      [lineId, reconciliationId, companyId, journalLineId, userId],
    );
    await client.query("COMMIT");
    return { ok: true, line_id: lineId, journal_line_id: journalLineId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeReconciliation({ companyId, userId, reconciliationId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const header = await client.query(
      `SELECT * FROM erp_bank_reconciliations WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [reconciliationId, companyId],
    );
    if (!header.rowCount) throw new Error("Reconciliation not found or already completed");
    if (header.rows[0].created_by === userId) {
      throw new Error("A different finance approver must complete the reconciliation");
    }
    const totals = await client.query(
      `SELECT COUNT(*)::int AS line_count,
              COUNT(journal_line_id)::int AS matched_count,
              COALESCE(SUM(credit - debit), 0) AS movement
       FROM erp_bank_reconciliation_lines WHERE reconciliation_id = $1 AND company_id = $2`,
      [reconciliationId, companyId],
    );
    const summary = totals.rows[0];
    const calculated = Math.round((Number(header.rows[0].opening_balance) + Number(summary.movement)) * 100) / 100;
    if (!summary.line_count || Number(summary.line_count) !== Number(summary.matched_count)) {
      throw new Error("Match every statement line to a posted bank ledger entry before completing reconciliation");
    }
    if (Math.abs(calculated - Number(header.rows[0].closing_balance)) > 0.01) {
      throw new Error("Statement closing balance no longer agrees with its imported transactions");
    }
    const result = await client.query(
      `UPDATE erp_bank_reconciliations SET status = 'reconciled', reconciled_at = NOW(), reconciled_by = $3
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [reconciliationId, companyId, userId],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createReconciliation, listReconciliations, getReconciliation, listCandidates, matchStatementLine, completeReconciliation };
