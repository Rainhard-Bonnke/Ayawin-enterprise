const pool = require('../db');

async function nextJournalNo(client, companyId) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS n FROM erp_journals WHERE company_id = $1`,
    [companyId],
  );
  const seq = Number(result.rows[0].n) + 1;
  return `JE-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
}

async function getOpenPeriod(client, companyId, entryDate) {
  const result = await client.query(
    `SELECT fp.* FROM erp_fiscal_periods fp
     WHERE fp.company_id = $1 AND fp.status = 'open' AND fp.is_deleted = FALSE
       AND $2::date BETWEEN fp.start_date AND fp.end_date
     ORDER BY fp.period_no LIMIT 1`,
    [companyId, entryDate],
  );
  return result.rows[0] || null;
}

function validateLinesBalanced(lines) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new Error(`Journal not balanced: debit ${totalDebit} != credit ${totalCredit}`);
  }
  if (totalDebit <= 0) throw new Error('Journal totals must be greater than zero');
  return { totalDebit, totalCredit };
}

async function createJournal({
  companyId,
  userId,
  entryDate,
  journalType = 'general',
  referenceNo,
  description,
  lines,
  branchId,
  currencyCode = 'KES',
  exchangeRate = 1,
}) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('At least two journal lines required');
  }
  const { totalDebit, totalCredit } = validateLinesBalanced(lines);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const period = await getOpenPeriod(client, companyId, entryDate || new Date());
    if (!period) throw new Error('No open fiscal period for entry date');

    const journalNo = await nextJournalNo(client, companyId);
    const journalResult = await client.query(
      `INSERT INTO erp_journals (
         company_id, fiscal_period_id, branch_id, journal_no, journal_type, entry_date,
         reference_no, description, currency_code, exchange_rate, status,
         total_debit, total_credit, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,'draft',$11,$12,$13)
       RETURNING *`,
      [
        companyId, period.id, branchId, journalNo, journalType, entryDate,
        referenceNo, description, currencyCode, exchangeRate,
        totalDebit, totalCredit, userId,
      ],
    );
    const journal = journalResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO erp_journal_lines (
           company_id, journal_id, line_no, account_id, description,
           debit, credit, currency_code, cost_centre, department, project_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          companyId, journal.id, lineNo++, line.account_id, line.description || description,
          line.debit || 0, line.credit || 0, currencyCode,
          line.cost_centre, line.department, line.project_code,
        ],
      );
    }

    await client.query('COMMIT');
    return journal;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postJournal({ journalId, companyId, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const journalResult = await client.query(
      `SELECT j.* FROM erp_journals j
       WHERE j.id = $1 AND j.company_id = $2 AND j.is_deleted = FALSE FOR UPDATE`,
      [journalId, companyId],
    );
    const journal = journalResult.rows[0];
    if (!journal) throw new Error('Journal not found');
    if (journal.status === 'posted') throw new Error('Journal already posted');
    if (journal.fiscal_period_id) {
      const periodResult = await client.query(
        `SELECT status FROM erp_fiscal_periods WHERE id = $1 AND company_id = $2`,
        [journal.fiscal_period_id, companyId],
      );
      const periodStatus = periodResult.rows[0]?.status;
      if (periodStatus && periodStatus !== 'open') {
        throw new Error('Fiscal period is not open');
      }
    }

    const lines = await client.query(
      `SELECT jl.*, a.is_postable, a.account_code
       FROM erp_journal_lines jl
       JOIN erp_chart_of_accounts a ON a.id = jl.account_id
       WHERE jl.journal_id = $1`,
      [journalId],
    );
    validateLinesBalanced(lines.rows);

    for (const line of lines.rows) {
      if (!line.is_postable) {
        throw new Error(`Account ${line.account_code} is not postable`);
      }
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
        [
          companyId, journal.fiscal_period_id, line.account_id,
          line.debit, line.credit, userId,
        ],
      );
    }

    await client.query(
      `UPDATE erp_journals SET status = 'posted', posted_at = NOW(), posted_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [journalId, companyId, userId],
    );

    await client.query('COMMIT');
    return { ok: true, journal_id: journalId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getTrialBalance(companyId, fiscalPeriodId) {
  const result = await pool.query(
    `SELECT a.account_code, a.account_name, a.account_type,
            b.opening_debit, b.opening_credit, b.period_debit, b.period_credit,
            b.closing_debit, b.closing_credit
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2 AND b.is_deleted = FALSE
     ORDER BY a.account_code`,
    [companyId, fiscalPeriodId],
  );
  return result.rows;
}

module.exports = {
  createJournal,
  postJournal,
  getTrialBalance,
  validateLinesBalanced,
  nextJournalNo,
};
