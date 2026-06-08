const pool = require('../db');

const TIER_LIST_CODES = {
  retail: 'RETAIL-2026',
  wholesale: 'WHOLESALE-2026',
  distributor: 'DIST-2026',
};

function priceTierFromCustomerType(customerType) {
  const t = String(customerType || '').toLowerCase();
  if (t.includes('distribut')) return 'distributor';
  if (t.includes('super') || t.includes('wholesale') || t.includes('bar')) return 'wholesale';
  return 'retail';
}

async function resolveUnitPrice(client, companyId, customerId, itemId) {
  const db = client?.query ? client : pool;
  const cust = await db.query(
    `SELECT customer_type FROM erp_customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [customerId, companyId],
  );
  if (!cust.rowCount) throw new Error('Customer not found');
  const tier = priceTierFromCustomerType(cust.rows[0].customer_type);
  const listCode = TIER_LIST_CODES[tier] || TIER_LIST_CODES.retail;

  const priced = await db.query(
    `SELECT pli.unit_price
     FROM erp_price_list_items pli
     JOIN erp_price_lists pl ON pl.id = pli.price_list_id AND pl.company_id = pli.company_id
     WHERE pli.company_id = $1 AND pli.item_id = $2 AND pl.code = $3
       AND pli.is_deleted = FALSE AND pl.is_deleted = FALSE
     ORDER BY pli.min_qty ASC
     LIMIT 1`,
    [companyId, itemId, listCode],
  );
  if (priced.rowCount) {
    return { unit_price: Number(priced.rows[0].unit_price), price_tier: tier, price_list_code: listCode };
  }

  const item = await db.query(
    `SELECT standard_cost FROM erp_items WHERE id = $1 AND company_id = $2`,
    [itemId, companyId],
  );
  return {
    unit_price: Number(item.rows[0]?.standard_cost || 0),
    price_tier: tier,
    price_list_code: null,
  };
}

module.exports = { priceTierFromCustomerType, resolveUnitPrice, TIER_LIST_CODES };
