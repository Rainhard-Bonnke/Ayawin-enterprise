const pool = require('../../src/db');
const bcrypt = require('bcryptjs');
const { ensureErpFoundation } = require('../../src/erpBootstrap');

let cachedContext = null;

async function getTestContext() {
  if (cachedContext) return cachedContext;
  await ensureErpFoundation();

  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  const user = await pool.query(
    `SELECT id, email FROM erp_users WHERE email = 'admin@martin.co.ke' LIMIT 1`,
  );
  const branch = await pool.query(
    `SELECT id FROM erp_branches WHERE company_id = $1 AND code = 'HQ' LIMIT 1`,
    [company.rows[0].id],
  );
  const warehouse = await pool.query(
    `SELECT id FROM erp_warehouses WHERE company_id = $1 AND code = 'WH-NRB' LIMIT 1`,
    [company.rows[0].id],
  );

  cachedContext = {
    companyId: company.rows[0].id,
    userId: user.rows[0].id,
    branchId: branch.rows[0].id,
    warehouseId: warehouse.rows[0].id,
  };
  return cachedContext;
}

async function getVendorId(companyId, code = 'V001') {
  const r = await pool.query(
    'SELECT id FROM erp_vendors WHERE company_id = $1 AND vendor_code = $2',
    [companyId, code],
  );
  return r.rows[0].id;
}

async function getCustomerId(companyId, code = 'C001') {
  const r = await pool.query(
    'SELECT id FROM erp_customers WHERE company_id = $1 AND customer_code = $2',
    [companyId, code],
  );
  return r.rows[0].id;
}

async function getItemId(companyId, sku = 'TSK-500') {
  const r = await pool.query(
    'SELECT id FROM erp_items WHERE company_id = $1 AND item_code = $2',
    [companyId, sku],
  );
  return r.rows[0].id;
}

module.exports = { getTestContext, getVendorId, getCustomerId, getItemId, pool };
