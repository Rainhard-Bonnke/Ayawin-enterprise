const pool = require('../db');
const accounting = require('./accountingService');

async function getOpenPeriod(companyId) {
  const result = await pool.query(
    `SELECT fp.*, fy.year_label AS fiscal_year_name
     FROM erp_fiscal_periods fp
     JOIN erp_fiscal_years fy ON fy.id = fp.fiscal_year_id
     WHERE fp.company_id = $1 AND fp.status = 'open' AND fp.is_deleted = FALSE
     ORDER BY fp.start_date DESC LIMIT 1`,
    [companyId],
  );
  return result.rows[0] || null;
}

async function previewMonthEnd(companyId, periodId) {
  const period = await pool.query(
    `SELECT * FROM erp_fiscal_periods WHERE id = $1 AND company_id = $2`,
    [periodId, companyId],
  );
  if (!period.rowCount) throw new Error('Fiscal period not found');
  if (period.rows[0].status !== 'open') throw new Error('Period is not open');

  const tbReport = await accounting.getTrialBalanceReport(companyId, periodId);
  const difference = tbReport.totals.difference;

  const drafts = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM erp_customer_invoices WHERE company_id = $1 AND status = 'draft') AS draft_invoices,
       (SELECT COUNT(*)::int FROM erp_journals WHERE company_id = $1 AND status = 'draft' AND is_deleted = FALSE) AS draft_journals,
       (SELECT COUNT(*)::int FROM erp_sales_orders WHERE company_id = $1 AND status IN ('draft','confirmed') AND is_deleted = FALSE) AS open_orders`,
    [companyId],
  );

  const blockers = [];
  if (Math.abs(difference) > 0.01) blockers.push(`Trial balance out by ${difference}`);
  const journalBalanced = await accounting.verifyPostedJournalsBalanced(companyId);
  if (!journalBalanced.ok) {
    blockers.push(`${journalBalanced.unbalanced.length} posted journal(s) out of balance`);
  }
  if (drafts.rows[0].draft_invoices > 0) blockers.push(`${drafts.rows[0].draft_invoices} draft invoice(s)`);
  if (drafts.rows[0].draft_journals > 0) blockers.push(`${drafts.rows[0].draft_journals} draft journal(s)`);

  return {
    period: period.rows[0],
    trial_balance: tbReport.totals,
    posted_journals: tbReport.posted_journals,
    blockers,
    can_close: blockers.length === 0,
  };
}

async function executeMonthEnd({ companyId, userId, periodId, force = false }) {
  const preview = await previewMonthEnd(companyId, periodId);
  if (!preview.can_close && !force) {
    const err = new Error('Month-end checks failed');
    err.code = 'MONTH_END_BLOCKED';
    err.details = preview;
    throw err;
  }

  const result = await pool.query(
    `UPDATE erp_fiscal_periods
     SET status = 'closed', closed_at = NOW(), closed_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'open'
     RETURNING *`,
    [periodId, companyId, userId],
  );
  if (!result.rowCount) throw new Error('Period not found or already closed');

  return { ok: true, period: result.rows[0], preview };
}

module.exports = { getOpenPeriod, previewMonthEnd, executeMonthEnd };
