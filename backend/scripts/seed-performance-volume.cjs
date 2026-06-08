#!/usr/bin/env node
/**
 * Seed MARTIN company with volume data for performance benchmarks.
 * Usage: node scripts/seed-performance-volume.cjs [--purge]
 */
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DATABASE_HOST || 'localhost',
        port: Number(process.env.DATABASE_PORT || 5432),
        user: process.env.DATABASE_USER || 'postgres',
        password: process.env.DATABASE_PASSWORD || 'postgres',
        database: process.env.DATABASE_DB || 'ayawin_enterprise',
      },
);

const TARGET_SKUS = 500;
const TARGET_INVOICES = 5000;
const TARGET_ORDERS = 10000;
const PREFIX = 'PERF-';

async function main() {
  const purge = process.argv.includes('--purge');
  const client = await pool.connect();
  try {
    const co = await client.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
    if (!co.rowCount) throw new Error('MARTIN company not found — run db:migrate first');
    const companyId = co.rows[0].id;

    const cust = await client.query(
      `SELECT id FROM erp_customers WHERE company_id = $1 AND is_deleted = FALSE LIMIT 1`,
      [companyId],
    );
    if (!cust.rowCount) throw new Error('No customer for MARTIN');
    const customerId = cust.rows[0].id;

    const uom = await client.query(`SELECT id FROM erp_uom WHERE company_id = $1 LIMIT 1`, [companyId]);
    const uomId = uom.rows[0]?.id || null;

    if (purge) {
      console.log('Purging prior PERF-* seed data…');
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM erp_customer_invoice_lines WHERE company_id = $1
         AND invoice_id IN (SELECT id FROM erp_customer_invoices WHERE company_id = $1 AND invoice_no LIKE $2)`,
        [companyId, `${PREFIX}INV-%`],
      );
      await client.query(`DELETE FROM erp_customer_invoices WHERE company_id = $1 AND invoice_no LIKE $2`, [
        companyId,
        `${PREFIX}INV-%`,
      ]);
      await client.query(
        `DELETE FROM erp_sales_order_lines WHERE company_id = $1
         AND sales_order_id IN (SELECT id FROM erp_sales_orders WHERE company_id = $1 AND order_no LIKE $2)`,
        [companyId, `${PREFIX}SO-%`],
      );
      await client.query(`DELETE FROM erp_sales_orders WHERE company_id = $1 AND order_no LIKE $2`, [
        companyId,
        `${PREFIX}SO-%`,
      ]);
      await client.query(`DELETE FROM erp_items WHERE company_id = $1 AND item_code LIKE $2`, [
        companyId,
        `${PREFIX}SKU-%`,
      ]);
      await client.query('COMMIT');
    }

    const countsBefore = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM erp_items WHERE company_id = $1 AND item_code LIKE $2 AND is_deleted = FALSE) AS skus,
         (SELECT COUNT(*)::int FROM erp_sales_orders WHERE company_id = $1 AND order_no LIKE $3) AS orders,
         (SELECT COUNT(*)::int FROM erp_customer_invoices WHERE company_id = $1 AND invoice_no LIKE $4) AS invoices`,
      [companyId, `${PREFIX}SKU-%`, `${PREFIX}SO-%`, `${PREFIX}INV-%`],
    );
    const before = countsBefore.rows[0];
    const skusToAdd = Math.max(0, TARGET_SKUS - before.skus);
    const ordersToAdd = Math.max(0, TARGET_ORDERS - before.orders);
    const invToAdd = Math.max(0, TARGET_INVOICES - before.invoices);

    await client.query('BEGIN');

    if (skusToAdd > 0) {
      console.log(`Inserting ${skusToAdd} items…`);
      await client.query(
        `INSERT INTO erp_items (company_id, uom_id, item_code, name, standard_cost, is_active, is_saleable, is_stock_item, cost_method)
         SELECT $1, $2,
                $3 || 'SKU-' || lpad(n::text, 5, '0'),
                'Performance SKU ' || n::text,
                100 + (n % 50),
                TRUE, TRUE, TRUE, 'weighted_average'
         FROM generate_series($4::int, $5::int) AS n
         ON CONFLICT (company_id, item_code) DO NOTHING`,
        [companyId, uomId, PREFIX, before.skus + 1, before.skus + skusToAdd],
      );
    }

    const itemRow = await client.query(
      `SELECT id FROM erp_items WHERE company_id = $1 AND item_code LIKE $2 AND is_deleted = FALSE ORDER BY item_code LIMIT 1`,
      [companyId, `${PREFIX}SKU-%`],
    );
    const sampleItemId = itemRow.rows[0]?.id;
    if (!sampleItemId) throw new Error('No PERF items available');

    if (ordersToAdd > 0) {
      console.log(`Inserting ${ordersToAdd} sales orders…`);
      await client.query(
        `INSERT INTO erp_sales_orders (company_id, customer_id, order_no, order_date, status, subtotal, tax_amount, total_amount, credit_check_passed)
         SELECT $1, $2,
                $3 || 'SO-' || lpad(n::text, 6, '0'),
                CURRENT_DATE - ((n - 1) % 365),
                CASE WHEN n % 5 = 0 THEN 'invoiced' ELSE 'confirmed' END,
                1000, 160, 1160, TRUE
         FROM generate_series($4::int, $5::int) AS n`,
        [companyId, customerId, PREFIX, before.orders + 1, before.orders + ordersToAdd],
      );
      await client.query(
        `INSERT INTO erp_sales_order_lines (company_id, sales_order_id, line_no, item_id, quantity, unit_price, line_total)
         SELECT so.company_id, so.id, 1, $3, 1, 1000, 1000
         FROM erp_sales_orders so
         WHERE so.company_id = $1 AND so.order_no LIKE $2
           AND NOT EXISTS (SELECT 1 FROM erp_sales_order_lines sol WHERE sol.sales_order_id = so.id)`,
        [companyId, `${PREFIX}SO-%`, sampleItemId],
      );
    }

    if (invToAdd > 0) {
      console.log(`Inserting ${invToAdd} invoices…`);
      await client.query(
        `INSERT INTO erp_customer_invoices (company_id, customer_id, invoice_no, invoice_date, due_date, status, subtotal, tax_amount, total_amount, amount_paid, posted_at)
         SELECT $1, $2,
                $3 || 'INV-' || lpad(n::text, 6, '0'),
                CURRENT_DATE - ((n - 1) % 365),
                CURRENT_DATE - ((n - 1) % 365) - 30,
                CASE WHEN n % 4 = 0 THEN 'paid' WHEN n % 3 = 0 THEN 'overdue' ELSE 'posted' END,
                1000, 160, 1160,
                CASE WHEN n % 4 = 0 THEN 1160 ELSE 0 END,
                NOW()
         FROM generate_series($4::int, $5::int) AS n`,
        [companyId, customerId, PREFIX, before.invoices + 1, before.invoices + invToAdd],
      );
      await client.query(
        `INSERT INTO erp_customer_invoice_lines (company_id, invoice_id, line_no, item_id, quantity, unit_price, tax_amount, line_total)
         SELECT inv.company_id, inv.id, 1, $3, 1, 1000, 160, 1000
         FROM erp_customer_invoices inv
         WHERE inv.company_id = $1 AND inv.invoice_no LIKE $2
           AND NOT EXISTS (SELECT 1 FROM erp_customer_invoice_lines il WHERE il.invoice_id = inv.id)`,
        [companyId, `${PREFIX}INV-%`, sampleItemId],
      );
    }

    await client.query('COMMIT');

    const after = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM erp_items WHERE company_id = $1 AND item_code LIKE $2 AND is_deleted = FALSE) AS skus,
         (SELECT COUNT(*)::int FROM erp_sales_orders WHERE company_id = $1 AND order_no LIKE $3) AS orders,
         (SELECT COUNT(*)::int FROM erp_customer_invoices WHERE company_id = $1 AND invoice_no LIKE $4) AS invoices`,
      [companyId, `${PREFIX}SKU-%`, `${PREFIX}SO-%`, `${PREFIX}INV-%`],
    );
    console.log('\nPerformance seed complete:', after.rows[0]);
    console.log('Run: npm run benchmark:perf (API must be running on :4000)\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
