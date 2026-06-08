#!/usr/bin/env node
/**
 * Reset dev database to a clean, writable state:
 * - Run migrations
 * - Purge demo transactions (keeps users, COA, master items/customers)
 * - Restore opening stock at WH-NRB so sales/invoices can be tested
 *
 * Usage: npm run dev:reset-db
 * Requires: CONFIRM_RESET_DEV=yes
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../src/db');
const { ensureErpFoundation } = require('../src/erpBootstrap');

const PURGE_TABLES = [
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

const OPENING_STOCK = [
  ['WH-NRB', 'LIVE-BEER-500', 500, 85],
  ['WH-NRB', 'LIVE-COKE-500', 1000, 42],
  ['WH-NRB', 'TSK-500', 500, 178],
  ['WH-NRB', 'GNS-500', 300, 220],
  ['WH-NRB', 'COKE-500', 1000, 40],
];

async function purgeTransactions(client, companyId) {
  for (const table of PURGE_TABLES) {
    const hasCol = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_id'`,
      [table],
    );
    if (!hasCol.rowCount) continue;
    const r = await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
    console.log(`  ${table}: ${r.rowCount} deleted`);
  }
  await client.query(
    `UPDATE erp_stock_on_hand SET quantity = 0, avg_unit_cost = 0, updated_at = NOW() WHERE company_id = $1`,
    [companyId],
  );
  console.log('  erp_stock_on_hand: quantities zeroed');
}

async function restoreOpeningStock(client, companyId) {
  for (const [wh, sku, qty, cost] of OPENING_STOCK) {
    await client.query(
      `UPDATE erp_stock_on_hand s
       SET quantity = $4, avg_unit_cost = $5, last_movement_at = NOW(), updated_at = NOW()
       FROM erp_warehouses w, erp_items i
       WHERE s.company_id = $1 AND s.warehouse_id = w.id AND s.item_id = i.id
         AND w.company_id = $1 AND w.code = $2
         AND i.company_id = $1 AND i.item_code = $3`,
      [companyId, wh, sku, qty, cost],
    );
  }
  console.log('  Opening stock restored for WH-NRB (TSK-500, GNS-500, COKE-500)');
}

async function printSummary(companyId) {
  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM erp_customers WHERE company_id = $1 AND is_deleted = FALSE) AS customers,
       (SELECT COUNT(*)::int FROM erp_items WHERE company_id = $1 AND is_deleted = FALSE) AS items,
       (SELECT COALESCE(SUM(quantity), 0)::numeric FROM erp_stock_on_hand WHERE company_id = $1) AS stock_units,
       (SELECT COUNT(*)::int FROM erp_sales_orders WHERE company_id = $1) AS sales_orders,
       (SELECT COUNT(*)::int FROM erp_customer_invoices WHERE company_id = $1) AS invoices`,
    [companyId],
  );
  const row = counts.rows[0];
  console.log('\nDatabase summary:');
  console.log(`  Customers: ${row.customers}`);
  console.log(`  Items: ${row.items}`);
  console.log(`  Stock units on hand: ${row.stock_units}`);
  console.log(`  Sales orders: ${row.sales_orders}`);
  console.log(`  Invoices: ${row.invoices}`);
}

async function main() {
  if (process.env.CONFIRM_RESET_DEV !== 'yes') {
    console.error('Set CONFIRM_RESET_DEV=yes to reset the dev database.');
    console.error('Example: $env:CONFIRM_RESET_DEV="yes"; npm run dev:reset-db');
    process.exit(1);
  }

  console.log('\n→ Running migrations…');
  await ensureErpFoundation();

  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  if (!company.rowCount) {
    console.error('Company MARTIN not found. Check migrations and DATABASE_* in backend/.env');
    process.exit(1);
  }
  const companyId = company.rows[0].id;

  const client = await pool.connect();
  try {
    console.log('\n→ Purging demo transactions…');
    await client.query('BEGIN');
    await purgeTransactions(client, companyId);
    await restoreOpeningStock(client, companyId);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await printSummary(companyId);

  console.log('\n✓ Dev database is clean and connected to the API.');
  console.log('\nNext steps:');
  console.log('  1. npm run dev:all   (from repo root)');
  console.log('  2. Sign in: admin@martin.co.ke / demo');
  console.log('  3. Header badge should show Live or Polling (not Demo / API off)');
  console.log('  4. Add stock: Inventory → Stock in (or use restored COKE-500 / TSK-500)');
  console.log('  5. Create sales order → confirm → deliver → invoice');
  console.log('\nReplace seed names with your data: data/live-import/*.csv → npm run go-live:import\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
