#!/usr/bin/env node
/**
 * Import live master data from CSV templates in data/live-import/
 * Usage: npm run go-live:import
 *        npm run go-live:import -- --only customers,items,vendors
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { csvToObjects } = require('./lib/parse-csv.cjs');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../src/db');
const { processImport } = require('../src/services/importService');
const { ensureErpFoundation } = require('../src/erpBootstrap');

const dataDir = path.resolve(__dirname, '..', '..', 'data', 'live-import');

const FILES = {
  customers: { file: 'customers.csv', map: (r) => ({
    customer_code: r.customer_code,
    name: r.name,
    email: r.email || null,
    tax_id: r.tax_id || r.kra_pin || null,
    credit_limit: r.credit_limit ?? 0,
  }) },
  items: { file: 'items.csv', map: (r) => ({
    item_code: r.item_code || r.sku,
    name: r.name,
    standard_cost: r.standard_cost ?? 0,
  }) },
  vendors: { file: 'vendors.csv', map: (r) => ({
    vendor_code: r.vendor_code,
    name: r.name,
    email: r.email || null,
    tax_id: r.tax_id || r.kra_pin || null,
    credit_limit: r.credit_limit ?? 0,
  }) },
  opening_stock: { file: 'opening_stock.csv', map: (r) => ({
    warehouse_code: r.warehouse_code || r.warehouse,
    item_code: r.item_code || r.sku,
    quantity: r.quantity,
    unit_cost: r.unit_cost ?? r.cost ?? 0,
  }) },
};

async function main() {
  await ensureErpFoundation();
  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  const user = await pool.query(`SELECT id FROM erp_users WHERE email = 'admin@martin.co.ke' LIMIT 1`);
  if (!company.rowCount || !user.rowCount) {
    console.error('Company MARTIN or admin user not found.');
    process.exit(1);
  }
  const companyId = company.rows[0].id;
  const userId = user.rows[0].id;

  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.replace('--only=', '').split(',').map((s) => s.trim()) : Object.keys(FILES);

  for (const entity of only) {
    const spec = FILES[entity];
    if (!spec) {
      console.warn(`Unknown entity: ${entity}`);
      continue;
    }
    const filePath = path.join(dataDir, spec.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skip ${entity}: missing ${filePath}`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const raw = csvToObjects(text);
    const rows = raw.map(spec.map).filter((r) =>
      r.customer_code || r.item_code || r.vendor_code || (r.warehouse_code && r.item_code),
    );
    if (!rows.length) {
      console.warn(`Skip ${entity}: no data rows in ${spec.file}`);
      continue;
    }
    const result = await processImport({
      companyId,
      userId,
      entityType: entity,
      rows,
      fileName: spec.file,
    });
    console.log(`${entity}: ${result.success}/${result.total} imported (${result.errors?.length || 0} errors)`);
    if (result.errors?.length) {
      result.errors.slice(0, 5).forEach((e) => console.warn(`  row ${e.row}: ${e.error}`));
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
