const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../../src/db");
const { ensureErpFoundation } = require("../../src/erpBootstrap");

test("empty database migration leaves transaction tables empty and reference data present", async (t) => {
  if (process.env.VERIFY_CLEAN_MIGRATIONS !== "true") return t.skip("Requires a fresh CI database");
  await ensureErpFoundation();
  const company = (await pool.query("SELECT id FROM erp_companies WHERE code='MARTIN' LIMIT 1")).rows[0];
  assert.ok(company);
  const emptyTables = ["erp_customers", "erp_vendors", "erp_employees", "erp_journals", "erp_purchase_orders",
    "erp_sales_orders", "erp_customer_invoices", "erp_stock_on_hand"];
  for (const table of emptyTables) {
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE company_id=$1`, [company.id]);
    assert.equal(count.rows[0].count, 0, `${table} should be empty immediately after migrations`);
  }
  for (const table of ["erp_roles", "erp_permissions", "erp_chart_of_accounts", "erp_tax_groups"]) {
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE company_id=$1`, [company.id]);
    assert.ok(count.rows[0].count > 0, `${table} reference records should exist`);
  }
  const years = await pool.query("SELECT COUNT(*)::int AS count FROM erp_fiscal_years WHERE company_id=$1", [company.id]);
  assert.equal(years.rows[0].count, 0, "an administrator creates the initial fiscal year");
});
