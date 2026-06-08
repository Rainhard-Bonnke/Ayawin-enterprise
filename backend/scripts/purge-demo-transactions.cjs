#!/usr/bin/env node
/**
 * Removes demo transactional data for company MARTIN (keeps COA, users, warehouses, fiscal calendar).
 * Requires: CONFIRM_PURGE_DEMO=yes
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../src/db');

const TABLES = [
  'erp_receipt_allocations',
  'erp_customer_receipts',
  'erp_customer_invoice_lines',
  'erp_customer_invoices',
  'erp_credit_note_lines',
  'erp_credit_notes',
  'erp_delivery_note_lines',
  'erp_delivery_notes',
  'erp_sales_order_lines',
  'erp_sales_orders',
  'erp_quotation_lines',
  'erp_quotations',
  'erp_stock_adjustment_lines',
  'erp_stock_adjustments',
  'erp_vendor_payment_allocations',
  'erp_vendor_payments',
  'erp_vendor_invoice_lines',
  'erp_vendor_invoices',
  'erp_goods_receipt_lines',
  'erp_goods_receipts',
  'erp_purchase_order_lines',
  'erp_purchase_orders',
  'erp_purchase_requisition_lines',
  'erp_purchase_requisitions',
  'erp_payroll_payslips',
  'erp_payroll_runs',
  'erp_journal_lines',
  'erp_journals',
  'erp_bank_recon_matches',
  'erp_bank_statement_lines',
  'erp_import_jobs',
];

async function main() {
  if (process.env.CONFIRM_PURGE_DEMO !== 'yes') {
    console.error('Set CONFIRM_PURGE_DEMO=yes to run this destructive script.');
    process.exit(1);
  }

  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  if (!company.rowCount) {
    console.error('Company MARTIN not found');
    process.exit(1);
  }
  const companyId = company.rows[0].id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      const hasCol = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_id'`,
        [table],
      );
      if (!hasCol.rowCount) continue;
      const r = await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
      console.log(`  ${table}: ${r.rowCount} rows deleted`);
    }
    await client.query(
      `UPDATE erp_stock_on_hand SET quantity = 0, updated_at = NOW() WHERE company_id = $1`,
      [companyId],
    );
    console.log('  erp_stock_on_hand: quantities zeroed');
    await client.query('COMMIT');
    console.log('\nDemo transactions purged. Import live master CSVs next (npm run go-live:import).');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
