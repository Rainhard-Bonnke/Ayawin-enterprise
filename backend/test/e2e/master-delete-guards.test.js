const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getItemId, pool } = require('./helpers');
const sales = require('../../src/services/salesService');
const { assertCanDeleteCustomer } = require('../../src/lib/crudGuards');

test('cannot delete customer with active sales order', async () => {
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const cust = await pool.query(
    `INSERT INTO erp_customers (company_id, customer_code, name, credit_limit, is_active, created_by)
     VALUES ($1, $2, 'E2E Guard Customer', 1000000, TRUE, $3)
     RETURNING id`,
    [ctx.companyId, `E2E-DEL-${Date.now()}`, ctx.userId],
  );
  const customerId = cust.rows[0].id;

  await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 1, unit_price: 100 }],
  });

  await assert.rejects(
    () => assertCanDeleteCustomer(ctx.companyId, customerId),
    (err) => /active sales orders/i.test(err.message),
  );

  await pool.query('UPDATE erp_sales_orders SET status = $3 WHERE customer_id = $1 AND company_id = $2', [
    customerId,
    ctx.companyId,
    'cancelled',
  ]);

  await assert.doesNotReject(() => assertCanDeleteCustomer(ctx.companyId, customerId));

  await pool.query('UPDATE erp_customers SET is_deleted = TRUE WHERE id = $1', [customerId]);
});
