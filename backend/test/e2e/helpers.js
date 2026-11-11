const pool = require("../../src/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ensureErpFoundation } = require("../../src/erpBootstrap");
const { seedDemo } = require("../../scripts/seed-demo.cjs");

if (!process.env.DOC_VERIFY_SECRET || process.env.DOC_VERIFY_SECRET.length < 32) {
  process.env.DOC_VERIFY_SECRET = crypto.randomBytes(48).toString("hex");
}
if (!process.env.INTEGRATION_ENCRYPTION_KEY || process.env.INTEGRATION_ENCRYPTION_KEY.length < 32) {
  process.env.INTEGRATION_ENCRYPTION_KEY = "ayawin-e2e-integration-encryption-key-v1";
}

let cachedContext = null;

async function getTestContext() {
  if (cachedContext) return cachedContext;
  await ensureErpFoundation();
  await seedDemo();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("E2E setup requires ADMIN_EMAIL and ADMIN_PASSWORD");

  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  const user = await pool.query(
    `SELECT id, email FROM erp_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [adminEmail],
  );
  const reviewerRole = await pool.query(
    `SELECT id FROM erp_roles
     WHERE company_id=$1 AND name='System Administrator' AND is_deleted=FALSE LIMIT 1`,
    [company.rows[0].id],
  );
  const reviewer = await pool.query(
    `INSERT INTO erp_users (company_id,default_branch_id,role_id,username,email,full_name,status,created_by)
     SELECT $1,b.id,$2,'e2e-reviewer','e2e-reviewer@example.test','E2E Payroll Reviewer','active',$3
     FROM erp_branches b WHERE b.company_id=$1 AND b.code='HQ'
     ON CONFLICT (company_id,email) DO UPDATE SET
       role_id=EXCLUDED.role_id,status='active',is_deleted=FALSE,updated_at=NOW()
     RETURNING id`,
    [company.rows[0].id, reviewerRole.rows[0]?.id || null, user.rows[0].id],
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
    reviewerId: reviewer.rows[0].id,
    branchId: branch.rows[0].id,
    warehouseId: warehouse.rows[0].id,
  };
  // Demo invoices can age into overdue during long-lived local databases. Keep
  // workflow E2E fixtures eligible; credit-control tests set and restore their
  // own limits and overdue thresholds explicitly.
  await pool.query("UPDATE erp_customers SET credit_limit=1000000000 WHERE company_id=$1 AND customer_code='C001'", [cachedContext.companyId]);
  await pool.query(
    `UPDATE erp_system_settings SET setting_value='36500'::jsonb
     WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'`, [cachedContext.companyId]);
  return cachedContext;
}

async function getVendorId(companyId, code = "V001") {
  const r = await pool.query(
    "SELECT id FROM erp_vendors WHERE company_id = $1 AND vendor_code = $2",
    [companyId, code],
  );
  return r.rows[0].id;
}

async function getCustomerId(companyId, code = "C001") {
  const r = await pool.query(
    "SELECT id FROM erp_customers WHERE company_id = $1 AND customer_code = $2",
    [companyId, code],
  );
  return r.rows[0].id;
}

async function getItemId(companyId, sku = "TSK-500") {
  const r = await pool.query("SELECT id FROM erp_items WHERE company_id = $1 AND item_code = $2", [
    companyId,
    sku,
  ]);
  return r.rows[0].id;
}

module.exports = { getTestContext, getVendorId, getCustomerId, getItemId, pool };
