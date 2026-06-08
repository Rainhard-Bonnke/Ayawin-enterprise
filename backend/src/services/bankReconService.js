const pool = require('../db');

async function listBankAccounts(companyId) {
  const result = await pool.query(
    `SELECT b.*, a.account_code, a.account_name
     FROM erp_bank_accounts b
     LEFT JOIN erp_chart_of_accounts a ON a.id = b.gl_account_id
     WHERE b.company_id = $1 AND b.is_deleted = FALSE AND b.is_active = TRUE
     ORDER BY b.name`,
    [companyId],
  );
  return result.rows;
}

async function importStatementLines({ companyId, userId, bankAccountId, lines }) {
  if (!lines?.length) throw new Error('At least one statement line required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const line of lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const r = await client.query(
        `INSERT INTO erp_bank_statement_lines (
           company_id, bank_account_id, txn_date, description, reference_no, amount, created_by
         ) VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,
        [
          companyId,
          bankAccountId,
          line.txn_date,
          line.description || null,
          line.reference_no || null,
          amount,
          userId,
        ],
      );
      inserted.push(r.rows[0]);
    }
    await client.query('COMMIT');
    return { imported: inserted.length, lines: inserted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getUnmatched(companyId, bankAccountId) {
  const [statement, receipts, journals] = await Promise.all([
    pool.query(
      `SELECT * FROM erp_bank_statement_lines
       WHERE company_id = $1 AND bank_account_id = $2 AND status = 'unmatched'
       ORDER BY txn_date DESC`,
      [companyId, bankAccountId],
    ),
    pool.query(
      `SELECT r.id, r.receipt_no, r.receipt_date, r.amount, r.reference_no, c.name AS customer_name
       FROM erp_customer_receipts r
       JOIN erp_customers c ON c.id = r.customer_id
       WHERE r.company_id = $1 AND r.status = 'posted'
         AND NOT EXISTS (
           SELECT 1 FROM erp_bank_statement_lines sl
           WHERE sl.matched_receipt_id = r.id AND sl.status = 'matched'
         )
       ORDER BY r.receipt_date DESC LIMIT 100`,
      [companyId],
    ),
    pool.query(
      `SELECT j.id, j.journal_no, j.entry_date, j.description,
              SUM(jl.debit - jl.credit) AS net_amount
       FROM erp_journals j
       JOIN erp_journal_lines jl ON jl.journal_id = j.id
       JOIN erp_chart_of_accounts a ON a.id = jl.account_id
       JOIN erp_bank_accounts b ON b.gl_account_id = a.id AND b.id = $2
       WHERE j.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM erp_bank_statement_lines sl WHERE sl.matched_journal_id = j.id AND sl.status = 'matched'
         )
       GROUP BY j.id ORDER BY j.entry_date DESC LIMIT 50`,
      [companyId, bankAccountId],
    ),
  ]);

  return {
    statement_lines: statement.rows,
    open_receipts: receipts.rows,
    open_journals: journals.rows,
  };
}

async function matchStatementLine({ companyId, userId, statementLineId, receiptId, journalId }) {
  if (!receiptId && !journalId) throw new Error('receipt_id or journal_id required');
  const result = await pool.query(
    `UPDATE erp_bank_statement_lines
     SET status = 'matched',
         matched_receipt_id = $3,
         matched_journal_id = $4,
         matched_at = NOW(),
         matched_by = $5
     WHERE id = $1 AND company_id = $2 AND status = 'unmatched'
     RETURNING *`,
    [statementLineId, companyId, receiptId || null, journalId || null, userId],
  );
  if (!result.rowCount) throw new Error('Statement line not found or already matched');
  return result.rows[0];
}

async function suggestMatches(companyId, bankAccountId) {
  const { statement_lines, open_receipts } = await getUnmatched(companyId, bankAccountId);
  const suggestions = [];
  for (const sl of statement_lines) {
    const amt = Number(sl.amount);
    const match = open_receipts.find(
      (r) =>
        Math.abs(Number(r.amount) - Math.abs(amt)) < 0.01 &&
        Math.abs(new Date(r.receipt_date).getTime() - new Date(sl.txn_date).getTime()) <=
          7 * 24 * 60 * 60 * 1000,
    );
    if (match) suggestions.push({ statement_line_id: sl.id, receipt_id: match.id, confidence: 'amount_date' });
  }
  return suggestions;
}

module.exports = {
  listBankAccounts,
  importStatementLines,
  getUnmatched,
  matchStatementLine,
  suggestMatches,
};
