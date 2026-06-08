#!/usr/bin/env node
/**
 * Validates AR outstanding vs invoice balances and trial-balance sanity.
 */
require('dotenv').config();
const pool = require('../src/db');
const { ensureErpFoundation } = require('../src/erpBootstrap');

async function main() {
  await ensureErpFoundation();
  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  if (!company.rowCount) {
    console.error('FAIL  Demo company not found');
    process.exit(1);
  }
  const companyId = company.rows[0].id;
  let failed = 0;

  const ar = await pool.query(
    `SELECT
       COALESCE(SUM(total_amount - amount_paid), 0) AS invoice_outstanding
     FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','overdue') AND is_deleted = FALSE`,
    [companyId],
  );
  const arGl = await pool.query(
    `SELECT COALESCE(SUM(b.period_debit - b.period_credit), 0) AS ar_balance
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id AND a.account_code = '1200'
     WHERE b.company_id = $1`,
    [companyId],
  );
  const invoiceOs = Number(ar.rows[0].invoice_outstanding);
  const glAr = Number(arGl.rows[0].ar_balance);
  const arDelta = Math.abs(invoiceOs - glAr);
  if (arDelta > 50000) {
    console.log(`WARN  Invoice outstanding ${invoiceOs} vs GL AR ${glAr} (delta ${arDelta}) — review postings`);
  } else {
    console.log(`PASS  AR invoice outstanding tracked (${invoiceOs})`);
  }

  const tb = await pool.query(
    `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
     FROM erp_journal_lines jl
     JOIN erp_journals j ON j.id = jl.journal_id
     WHERE j.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE`,
    [companyId],
  );
  const diff = Math.abs(Number(tb.rows[0].d) - Number(tb.rows[0].c));
  if (diff > 0.02) {
    console.log(`FAIL  Posted journals out of balance by ${diff}`);
    failed += 1;
  } else {
    console.log('PASS  Posted journal debits equal credits');
  }

  const taxSample = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_customer_invoices
     WHERE company_id = $1 AND tax_amount < 0`,
    [companyId],
  );
  if (taxSample.rows[0].n > 0) {
    console.log('FAIL  Negative VAT rows detected');
    failed += 1;
  } else {
    console.log('PASS  No negative VAT on invoices');
  }

  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
