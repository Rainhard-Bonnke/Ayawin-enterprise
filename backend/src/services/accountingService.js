const pool = require('../db');
const gl = require('./glPostingService');
const { ACCOUNT_CODES } = require('./accountCodes');

const KENYA_REQUIRED_ACCOUNTS = [
  { code: '1000', type: 'asset', name: 'Assets' },
  { code: '1100', type: 'asset', name: 'Cash at Bank' },
  { code: '1200', type: 'asset', name: 'Accounts Receivable' },
  { code: '1300', type: 'asset', name: 'Inventory' },
  { code: '2000', type: 'liability', name: 'Liabilities' },
  { code: '2100', type: 'liability', name: 'Accounts Payable' },
  { code: '2200', type: 'liability', name: 'VAT Output' },
  { code: '2300', type: 'liability', name: 'Excise Duty Payable' },
  { code: '3000', type: 'equity', name: 'Equity' },
  { code: '4000', type: 'income', name: 'Sales Revenue' },
  { code: '5000', type: 'expense', name: 'Cost of Goods Sold' },
  { code: '6000', type: 'expense', name: 'Operating Expenses' },
  { code: '6100', type: 'expense', name: 'Salaries & Wages' },
];

function signedBalance(row) {
  const type = row.account_type;
  const net = Number(row.closing_debit || 0) - Number(row.closing_credit || 0);
  if (type === 'asset' || type === 'expense') return net;
  return -net;
}

async function getKenyaCoaStatus(companyId) {
  const existing = await pool.query(
    `SELECT account_code, account_name, account_type FROM erp_chart_of_accounts
     WHERE company_id = $1 AND is_deleted = FALSE`,
    [companyId],
  );
  const byCode = Object.fromEntries(existing.rows.map((r) => [r.account_code, r]));
  const missing = KENYA_REQUIRED_ACCOUNTS.filter((a) => !byCode[a.code]);
  return { ok: missing.length === 0, accounts: existing.rows, missing };
}

async function getTrialBalanceReport(companyId, fiscalPeriodId) {
  const lines = await gl.getTrialBalance(companyId, fiscalPeriodId);
  const totals = lines.reduce(
    (acc, r) => ({
      period_debit: acc.period_debit + Number(r.period_debit || 0),
      period_credit: acc.period_credit + Number(r.period_credit || 0),
      closing_debit: acc.closing_debit + Number(r.closing_debit || 0),
      closing_credit: acc.closing_credit + Number(r.closing_credit || 0),
    }),
    { period_debit: 0, period_credit: 0, closing_debit: 0, closing_credit: 0 },
  );
  const difference = Math.round((totals.period_debit - totals.period_credit) * 100) / 100;

  const journalCheck = await pool.query(
    `SELECT COALESCE(SUM(jl.debit), 0)::numeric AS debit, COALESCE(SUM(jl.credit), 0)::numeric AS credit
     FROM erp_journal_lines jl
     JOIN erp_journals j ON j.id = jl.journal_id
     WHERE j.company_id = $1 AND j.fiscal_period_id = $2 AND j.status = 'posted' AND j.is_deleted = FALSE`,
    [companyId, fiscalPeriodId],
  );
  const jd = Number(journalCheck.rows[0]?.debit || 0);
  const jc = Number(journalCheck.rows[0]?.credit || 0);
  const journal_difference = Math.round((jd - jc) * 100) / 100;

  return {
    lines,
    totals: { ...totals, difference, balanced: Math.abs(difference) <= 0.01 },
    posted_journals: { debit: jd, credit: jc, difference: journal_difference, balanced: Math.abs(journal_difference) <= 0.01 },
  };
}

async function getProfitLossReport(companyId, fiscalPeriodId) {
  const result = await pool.query(
    `SELECT a.account_type, a.account_code, a.account_name,
            b.period_credit - b.period_debit AS amount
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2 AND a.is_deleted = FALSE
       AND a.account_type IN ('income', 'expense') AND a.is_postable = TRUE
     ORDER BY a.account_code`,
    [companyId, fiscalPeriodId],
  );
  const income = result.rows
    .filter((r) => r.account_type === 'income')
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const expense = result.rows
    .filter((r) => r.account_type === 'expense')
    .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
  return { lines: result.rows, total_income: income, total_expense: expense, net_profit: income - expense };
}

async function getBalanceSheetReport(companyId, fiscalPeriodId) {
  const result = await pool.query(
    `SELECT a.account_type, a.account_code, a.account_name,
            b.closing_debit, b.closing_credit
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2
       AND a.account_type IN ('asset', 'liability', 'equity') AND a.is_postable = TRUE
     ORDER BY a.account_code`,
    [companyId, fiscalPeriodId],
  );
  const rows = result.rows.map((r) => ({ ...r, balance: signedBalance(r) }));
  const assets = rows.filter((r) => r.account_type === 'asset').reduce((s, r) => s + r.balance, 0);
  const liabilities = rows.filter((r) => r.account_type === 'liability').reduce((s, r) => s + r.balance, 0);
  const equity = rows.filter((r) => r.account_type === 'equity').reduce((s, r) => s + r.balance, 0);
  const difference = Math.round((assets - (liabilities + equity)) * 100) / 100;
  return {
    lines: rows,
    totals: { assets, liabilities, equity, liabilities_plus_equity: liabilities + equity, difference },
    balanced: Math.abs(difference) <= 0.01,
  };
}

async function getVatReport(companyId, fromDate, toDate) {
  const params = [companyId];
  let dateFilter = '';
  if (fromDate) {
    params.push(fromDate);
    dateFilter += ` AND inv.invoice_date >= $${params.length}`;
  }
  if (toDate) {
    params.push(toDate);
    dateFilter += ` AND inv.invoice_date <= $${params.length}`;
  }

  const invoices = await pool.query(
    `SELECT inv.invoice_no, inv.invoice_date, c.name AS customer_name, c.tax_id AS customer_pin,
            inv.subtotal, inv.tax_amount, inv.excise_amount, inv.total_amount, inv.status
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.status NOT IN ('draft','cancelled') AND inv.is_deleted = FALSE
       AND inv.invoice_type IS DISTINCT FROM 'proforma' ${dateFilter}
     ORDER BY inv.invoice_date, inv.invoice_no`,
    params,
  );

  const invoiceVatTotal = invoices.rows.reduce((s, r) => s + Number(r.tax_amount || 0), 0);

  const glParams = [companyId, ACCOUNT_CODES.vatOutput];
  let glFilter = '';
  if (fromDate) {
    glParams.push(fromDate);
    glFilter += ` AND j.entry_date >= $${glParams.length}`;
  }
  if (toDate) {
    glParams.push(toDate);
    glFilter += ` AND j.entry_date <= $${glParams.length}`;
  }
  const glVat = await pool.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric AS vat_liability
     FROM erp_journal_lines jl
     JOIN erp_journals j ON j.id = jl.journal_id
     JOIN erp_chart_of_accounts a ON a.id = jl.account_id
     WHERE j.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE
       AND a.account_code = $2 ${glFilter}`,
    glParams,
  );
  const glVatTotal = Number(glVat.rows[0]?.vat_liability || 0);
  const variance = Math.round((invoiceVatTotal - glVatTotal) * 100) / 100;

  return {
    lines: invoices.rows,
    invoice_vat_total: invoiceVatTotal,
    gl_vat_total: glVatTotal,
    variance,
    matched: Math.abs(variance) <= 1,
    period: { from: fromDate || null, to: toDate || null },
  };
}

async function getExciseReport(companyId, fromDate, toDate) {
  const params = [companyId];
  let dateFilter = '';
  if (fromDate) {
    params.push(fromDate);
    dateFilter += ` AND inv.invoice_date >= $${params.length}`;
  }
  if (toDate) {
    params.push(toDate);
    dateFilter += ` AND inv.invoice_date <= $${params.length}`;
  }

  const lines = await pool.query(
    `SELECT inv.invoice_no, inv.invoice_date, c.tax_id AS customer_kra_pin, c.name AS customer_name,
            i.item_code, i.name AS product_name, cat.name AS product_category,
            vil.quantity, vil.unit_price, vil.excise_amount, vil.line_total,
            COALESCE(i.litres_per_unit, 0)::numeric AS litres_per_unit,
            (vil.quantity * COALESCE(i.litres_per_unit, 0))::numeric AS total_litres
     FROM erp_customer_invoice_lines vil
     JOIN erp_customer_invoices inv ON inv.id = vil.invoice_id
     JOIN erp_customers c ON c.id = inv.customer_id
     JOIN erp_items i ON i.id = vil.item_id
     LEFT JOIN erp_item_categories cat ON cat.id = i.category_id
     WHERE inv.company_id = $1 AND inv.status NOT IN ('draft','cancelled') AND inv.is_deleted = FALSE
       AND vil.excise_amount > 0 ${dateFilter}
     ORDER BY inv.invoice_date, inv.invoice_no, vil.line_no`,
    params,
  );

  const kraRows = lines.rows.map((row) => {
    const litres = Number(row.total_litres || 0);
    const excise = Number(row.excise_amount || 0);
    const ratePerLitre = litres > 0 ? Math.round((excise / litres) * 10000) / 10000 : 0;
    return {
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      customer_kra_pin: row.customer_kra_pin,
      customer_name: row.customer_name,
      product_code: row.item_code,
      product_description: row.product_name,
      product_category: row.product_category,
      quantity: Number(row.quantity),
      litres,
      excise_rate_per_litre: ratePerLitre,
      excise_amount: excise,
      line_value: Number(row.line_total),
    };
  });

  const invoiceExciseTotal = kraRows.reduce((s, r) => s + r.excise_amount, 0);

  const glParams = [companyId, ACCOUNT_CODES.excisePayable];
  let glFilter = '';
  if (fromDate) {
    glParams.push(fromDate);
    glFilter += ` AND j.entry_date >= $${glParams.length}`;
  }
  if (toDate) {
    glParams.push(toDate);
    glFilter += ` AND j.entry_date <= $${glParams.length}`;
  }
  const glExcise = await pool.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric AS excise_liability
     FROM erp_journal_lines jl
     JOIN erp_journals j ON j.id = jl.journal_id
     JOIN erp_chart_of_accounts a ON a.id = jl.account_id
     WHERE j.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE
       AND a.account_code = $2 ${glFilter}`,
    glParams,
  );
  const glExciseTotal = Number(glExcise.rows[0]?.excise_liability || 0);

  return {
    format: 'KRA_excise_return',
    lines: kraRows,
    totals: {
      total_litres: kraRows.reduce((s, r) => s + r.litres, 0),
      total_excise: invoiceExciseTotal,
      gl_excise: glExciseTotal,
      variance: Math.round((invoiceExciseTotal - glExciseTotal) * 100) / 100,
    },
    period: { from: fromDate || null, to: toDate || null },
  };
}

async function getMultiPeriodReport(companyId, { periodIds, fiscalYearId } = {}) {
  let periods;
  if (periodIds?.length) {
    const r = await pool.query(
      `SELECT id, period_no, name, start_date, end_date, status
       FROM erp_fiscal_periods
       WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_deleted = FALSE
       ORDER BY start_date`,
      [companyId, periodIds],
    );
    periods = r.rows;
  } else if (fiscalYearId) {
    const r = await pool.query(
      `SELECT id, period_no, name, start_date, end_date, status
       FROM erp_fiscal_periods
       WHERE company_id = $1 AND fiscal_year_id = $2 AND is_deleted = FALSE
       ORDER BY period_no`,
      [companyId, fiscalYearId],
    );
    periods = r.rows;
  } else {
    const r = await pool.query(
      `SELECT id, period_no, name, start_date, end_date, status
       FROM erp_fiscal_periods
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY start_date DESC LIMIT 12`,
      [companyId],
    );
    periods = r.rows.reverse();
  }

  const periodsData = [];
  for (const p of periods) {
    const pl = await getProfitLossReport(companyId, p.id);
    const tb = await getTrialBalanceReport(companyId, p.id);
    periodsData.push({
      period_id: p.id,
      period_no: p.period_no,
      name: p.name,
      status: p.status,
      start_date: p.start_date,
      end_date: p.end_date,
      income: pl.total_income,
      expense: pl.total_expense,
      net_profit: pl.net_profit,
      trial_balance_balanced: tb.totals.balanced,
    });
  }
  return { periods: periodsData };
}

async function verifyPostedJournalsBalanced(companyId) {
  const r = await pool.query(
    `SELECT j.id, j.journal_no,
            COALESCE(SUM(jl.debit), 0)::numeric AS debit,
            COALESCE(SUM(jl.credit), 0)::numeric AS credit
     FROM erp_journals j
     JOIN erp_journal_lines jl ON jl.journal_id = j.id
     WHERE j.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE
     GROUP BY j.id, j.journal_no
     HAVING ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) > 0.01`,
    [companyId],
  );
  return { ok: r.rowCount === 0, unbalanced: r.rows };
}

module.exports = {
  KENYA_REQUIRED_ACCOUNTS,
  getKenyaCoaStatus,
  getTrialBalanceReport,
  getProfitLossReport,
  getBalanceSheetReport,
  getVatReport,
  getExciseReport,
  getMultiPeriodReport,
  verifyPostedJournalsBalanced,
};
