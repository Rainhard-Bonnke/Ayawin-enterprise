#!/usr/bin/env node
/**
 * EXPLAIN ANALYZE key ERP queries — flags plans with execution time > 100ms.
 * Usage: node scripts/query-plan-audit.js
 */
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const THRESHOLD_MS = Number(process.env.QUERY_PLAN_THRESHOLD_MS || 100);

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

const QUERIES = [
  {
    name: 'Dashboard revenue in range',
    sql: `SELECT COALESCE(SUM(total_amount),0) AS total FROM erp_customer_invoices
          WHERE company_id = $1 AND invoice_date BETWEEN $2 AND $3
            AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE`,
    params: (ctx) => [ctx.companyId, ctx.from, ctx.to],
  },
  {
    name: 'Sales orders list (paginated)',
    sql: `SELECT so.id, so.order_no, so.order_date, so.status, so.total_amount, c.name AS customer_name
          FROM erp_sales_orders so
          JOIN erp_customers c ON c.id = so.customer_id
          WHERE so.company_id = $1 AND so.is_deleted = FALSE
          ORDER BY so.order_date DESC LIMIT 50 OFFSET 0`,
    params: (ctx) => [ctx.companyId],
  },
  {
    name: 'Customer invoices list (paginated)',
    sql: `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.status, inv.total_amount, c.name AS customer_name
          FROM erp_customer_invoices inv
          JOIN erp_customers c ON c.id = inv.customer_id
          WHERE inv.company_id = $1 AND inv.is_deleted = FALSE
          ORDER BY inv.invoice_date DESC LIMIT 50 OFFSET 0`,
    params: (ctx) => [ctx.companyId],
  },
  {
    name: 'Product search (trgm/ILIKE)',
    sql: `SELECT id, item_code, name FROM erp_items
          WHERE company_id = $1 AND is_deleted = FALSE AND is_active = TRUE
            AND (name ILIKE $2 OR item_code ILIKE $2)
          ORDER BY name LIMIT 50`,
    params: (ctx) => [ctx.companyId, '%PERF%'],
  },
  {
    name: 'Sales summary report (12m)',
    sql: `SELECT status, COUNT(*)::int AS order_count, COALESCE(SUM(total_amount),0) AS total
          FROM erp_sales_orders
          WHERE company_id = $1 AND is_deleted = FALSE AND order_date BETWEEN $2 AND $3
          GROUP BY status ORDER BY status`,
    params: (ctx) => [ctx.companyId, ctx.from, ctx.to],
  },
];

function parseExecutionMs(planLines) {
  const text = planLines.join('\n');
  const m = text.match(/Execution Time:\s*([\d.]+)\s*ms/i);
  return m ? Number(m[1]) : null;
}

async function main() {
  const client = await pool.connect();
  try {
    const co = await client.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
    if (!co.rowCount) throw new Error('MARTIN company not found');
    const companyId = co.rows[0].id;
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const ctx = { companyId, from, to };

    console.log(`\n=== Query plan audit (threshold ${THRESHOLD_MS}ms) ===\n`);
    let slow = 0;

    for (const q of QUERIES) {
      const params = q.params(ctx);
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`, params);
      const lines = plan.rows.map((r) => r['QUERY PLAN']);
      const ms = parseExecutionMs(lines);
      const status = ms != null && ms > THRESHOLD_MS ? 'SLOW' : 'OK';
      if (status === 'SLOW') slow += 1;
      console.log(`${status.padEnd(5)} ${q.name} — ${ms != null ? `${ms.toFixed(2)}ms` : 'n/a'}`);
      if (status === 'SLOW') {
        const idx = lines.findIndex((l) => l.includes('Index Scan') || l.includes('Seq Scan'));
        if (idx >= 0) console.log(`       ${lines[idx].trim()}`);
      }
    }

    console.log(`\n${slow ? `WARNING: ${slow} query(s) exceeded ${THRESHOLD_MS}ms` : 'All sampled queries within threshold.'}\n`);
    process.exit(slow ? 1 : 0);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
