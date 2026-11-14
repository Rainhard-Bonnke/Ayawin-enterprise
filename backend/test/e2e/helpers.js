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
    `INSERT INTO erp_warehouses (
       company_id, branch_id, code, name, city, is_active, is_deleted
     ) VALUES ($1,$2,'WH-NRB','E2E Main Warehouse','Nairobi',TRUE,FALSE)
     ON CONFLICT (company_id, code) DO UPDATE
       SET branch_id = EXCLUDED.branch_id,
           is_active = TRUE,
           is_deleted = FALSE,
           updated_at = NOW()
     RETURNING id`,
    [company.rows[0].id, branch.rows[0].id],
  );
  const priceList = await pool.query(
    `INSERT INTO erp_price_lists (
       company_id, code, name, currency_code, effective_from, is_default, is_active, is_deleted
     ) VALUES ($1,'RETAIL-2026','E2E Retail Price List','KES',CURRENT_DATE - 365,TRUE,TRUE,FALSE)
     ON CONFLICT (company_id, code) DO UPDATE
       SET effective_from = CURRENT_DATE - 365,
           effective_to = NULL,
           is_default = TRUE,
           is_active = TRUE,
           is_deleted = FALSE,
           updated_at = NOW()
     RETURNING id`,
    [company.rows[0].id],
  );
  await pool.query(
    "UPDATE erp_price_lists SET is_default=FALSE,updated_at=NOW() WHERE company_id=$1 AND id<>$2 AND is_default=TRUE",
    [company.rows[0].id, priceList.rows[0].id],
  );
  await pool.query(
    `INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price, min_qty, is_deleted)
     SELECT $1, $2, item.id, price.unit_price, 1, FALSE
     FROM erp_items item
     JOIN (VALUES
       ('TSK-500',250::numeric), ('GNS-500',320::numeric), ('JW-RED',2600::numeric),
       ('COKE-500',70::numeric), ('DSN-1L',70::numeric)
     ) AS price(item_code,unit_price) ON price.item_code = item.item_code
     WHERE item.company_id = $1
     ON CONFLICT (price_list_id, item_id, min_qty) DO UPDATE
       SET unit_price = EXCLUDED.unit_price, is_deleted = FALSE, updated_at = NOW()`,
    [company.rows[0].id, priceList.rows[0].id],
  );
  await pool.query(
    `INSERT INTO erp_stock_on_hand (
       company_id, warehouse_id, item_id, quantity, avg_unit_cost, last_movement_at, is_deleted
     )
     SELECT $1, $2, item.id, stock.quantity, stock.unit_cost, NOW(), FALSE
     FROM erp_items item
     JOIN (VALUES
       ('TSK-500',1240::numeric,178::numeric),
       ('GNS-500',540::numeric,220::numeric),
       ('COKE-500',3200::numeric,40::numeric),
       ('DSN-1L',250::numeric,45::numeric)
     ) AS stock(item_code,quantity,unit_cost) ON stock.item_code = item.item_code
     WHERE item.company_id = $1
     ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE
       SET quantity = EXCLUDED.quantity, avg_unit_cost = EXCLUDED.avg_unit_cost, last_movement_at = NOW(),
           is_deleted = FALSE, updated_at = NOW()`,
    [company.rows[0].id, warehouse.rows[0].id],
  );

  cachedContext = {
    companyId: company.rows[0].id,
    userId: user.rows[0].id,
    reviewerId: reviewer.rows[0].id,
    branchId: branch.rows[0].id,
    warehouseId: warehouse.rows[0].id,
    priceListId: priceList.rows[0].id,
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
  const result = await pool.query(
    `INSERT INTO erp_vendors (
       company_id, payment_terms_id, currency_code, vendor_code, name, is_active, is_deleted
     )
     SELECT $1, pt.id, 'KES', $2, $3, TRUE, FALSE
     FROM erp_payment_terms pt WHERE pt.company_id = $1 AND pt.code = 'NET30'
     ON CONFLICT (company_id, vendor_code) DO UPDATE
       SET payment_terms_id = EXCLUDED.payment_terms_id,
           currency_code = EXCLUDED.currency_code,
           is_active = TRUE,
           is_deleted = FALSE,
           updated_at = NOW()
     RETURNING id`,
    [companyId, code, `E2E supplier ${code}`],
  );
  if (!result.rowCount) throw new Error("Unable to create the E2E supplier fixture");
  return result.rows[0].id;
}

async function getCustomerId(companyId, code = "C001") {
  const existing = await pool.query(
    `SELECT id FROM erp_customers
     WHERE company_id = $1 AND customer_code = $2 AND is_active = TRUE AND is_deleted = FALSE`,
    [companyId, code],
  );
  let customerId = existing.rows[0]?.id;
  if (!customerId) {
    const result = await pool.query(
      `INSERT INTO erp_customers (
         company_id, payment_terms_id, currency_code, customer_code, name, credit_limit,
         customer_type, is_active, is_deleted
       )
       SELECT $1, pt.id, 'KES', $2, $3, 1000000000, 'E2E fixture', TRUE, FALSE
       FROM erp_payment_terms pt
       WHERE pt.company_id = $1 AND pt.code = 'NET30'
       ON CONFLICT (company_id, customer_code) DO UPDATE
         SET payment_terms_id = EXCLUDED.payment_terms_id,
             currency_code = EXCLUDED.currency_code,
             is_active = TRUE,
             is_deleted = FALSE,
             updated_at = NOW()
       RETURNING id`,
      [companyId, code, `E2E customer ${code}`],
    );
    if (!result.rowCount) throw new Error("Unable to create the E2E customer fixture");
    customerId = result.rows[0].id;
  }
  if (cachedContext?.priceListId) {
    await pool.query("UPDATE erp_customers SET price_list_id=$2 WHERE id=$1 AND company_id=$3", [
      customerId,
      cachedContext.priceListId,
      companyId,
    ]);
  }
  return customerId;
}

async function getItemId(companyId, sku = "TSK-500") {
  const r = await pool.query("SELECT id FROM erp_items WHERE company_id = $1 AND item_code = $2", [
    companyId,
    sku,
  ]);
  return r.rows[0].id;
}

module.exports = { getTestContext, getVendorId, getCustomerId, getItemId, pool };
