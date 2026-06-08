require('dotenv').config();
const pool = require('../src/db');

(async () => {
  const c = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN'`);
  const cid = c.rows[0].id;
  const p = await pool.query(
    `SELECT id, start_date, end_date FROM erp_fiscal_periods
     WHERE company_id = $1 AND is_deleted = FALSE
       AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
     ORDER BY start_date DESC LIMIT 1`,
    [cid],
  );
  if (!p.rowCount) {
    const latest = await pool.query(
      `SELECT id, start_date, end_date FROM erp_fiscal_periods
       WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1`,
      [cid],
    );
    p.rows = latest.rows;
  }
  const { start_date: start, end_date: end } = p.rows[0];
  const jl = await pool.query(
    `SELECT j.reference_no, j.description, SUM(l.credit - l.debit)::numeric AS rev
     FROM erp_journals j
     JOIN erp_journal_lines l ON l.journal_id = j.id
     JOIN erp_chart_of_accounts a ON a.id = l.account_id
     WHERE j.company_id = $1 AND j.status = 'posted' AND a.account_code = '4000'
       AND j.entry_date BETWEEN $2 AND $3
     GROUP BY j.id, j.reference_no, j.description
     ORDER BY rev DESC LIMIT 20`,
    [cid, start, end],
  );
  console.log('GL 4000 journals:', jl.rows);
  const inv = await pool.query(
    `SELECT i.invoice_no, i.subtotal, i.journal_id,
            COALESCE(SUM(jl.credit - jl.debit), 0)::numeric AS gl_rev
     FROM erp_customer_invoices i
     LEFT JOIN erp_journal_lines jl ON jl.journal_id = i.journal_id
     LEFT JOIN erp_chart_of_accounts a ON a.id = jl.account_id AND a.account_code = '4000'
     WHERE i.company_id = $1 AND i.status IN ('posted','partial','paid','overdue')
       AND i.journal_id IS NOT NULL AND i.invoice_date BETWEEN $2 AND $3
     GROUP BY i.invoice_no, i.subtotal, i.journal_id`,
    [cid, start, end],
  );
  const sum = inv.rows.reduce((s, r) => s + Number(r.subtotal), 0);
  const glSum = inv.rows.reduce((s, r) => s + Number(r.gl_rev), 0);
  console.log('invoices', inv.rowCount, 'subtotal sum', sum, 'linked GL 4000', glSum);
  const bad = inv.rows.filter((r) => Math.abs(Number(r.subtotal) - Number(r.gl_rev)) > 0.02);
  console.log('mismatched invoice/journal rows', bad.slice(0, 5));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
