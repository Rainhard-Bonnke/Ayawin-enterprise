const pool = require('../../src/db');
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

async function createTestCustomer(companyId, userId, { creditLimit = 500000 } = {}) {
  const suffix = Date.now().toString(36);
  const r = await pool.query(
    `INSERT INTO erp_customers (
       company_id, customer_code, name, tax_id, credit_limit, is_active, created_by
     ) VALUES ($1, $2, $3, $4, $5, TRUE, $6)
     RETURNING id, customer_code, credit_limit`,
    [companyId, `E2E-${suffix}`, `E2E Customer ${suffix}`, `P${suffix.toUpperCase().slice(0, 9)}`, creditLimit, userId],
  );
  return r.rows[0];
}

async function getDriverId(companyId) {
  const r = await pool.query(
    `SELECT id FROM erp_employees
     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE
       AND (job_title ILIKE '%driver%' OR department ILIKE '%logistics%')
     LIMIT 1`,
    [companyId],
  );
  return r.rows[0]?.id || null;
}

async function getGlBalance(companyId, accountCode, fiscalPeriodId = null) {
  const params = [companyId, accountCode];
  let periodFilter = '';
  if (fiscalPeriodId) {
    params.push(fiscalPeriodId);
    periodFilter = ` AND b.fiscal_period_id = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT COALESCE(SUM(b.period_debit - b.period_credit), 0)::numeric AS balance
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND a.account_code = $2 ${periodFilter}`,
    params,
  );
  return Number(r.rows[0]?.balance || 0);
}

async function countAuditActions(companyId, entityType, entityId, actions = []) {
  const params = [companyId, entityType, String(entityId)];
  let actionFilter = '';
  if (actions.length) {
    params.push(actions);
    actionFilter = ` AND a.action = ANY($${params.length}::text[])`;
  }
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_audit_log a
     WHERE a.company_id = $1 AND a.entity_type = $2 AND a.entity_id::text = $3::text ${actionFilter}`,
    params,
  );
  return r.rows[0].n;
}

module.exports = {
  getTestContext,
  getVendorId,
  getCustomerId,
  getItemId,
  createTestCustomer,
  getDriverId,
  getGlBalance,
  countAuditActions,
  pool,
};
