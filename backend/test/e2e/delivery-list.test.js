const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getCustomerId, getItemId, pool } = require('./helpers');
const sales = require('../../src/services/salesService');

test('E2E delivery list: posted delivery appears with order join', async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const so = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 5, unit_price: 70 }],
  });

  await sales.confirmSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    orderId: so.id,
  });

  const sol = await pool.query(
    'SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1',
    [so.id],
  );

  const delivery = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: so.id,
    warehouseId: ctx.warehouseId,
    lines: [{ so_line_id: sol.rows[0].id, item_id: itemId, quantity: 5 }],
  });
  assert.equal(delivery.ok, true);

  const listed = await pool.query(
    `SELECT d.delivery_no, d.status, so.order_no, c.name AS customer_name
     FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     JOIN erp_customers c ON c.id = so.customer_id
     WHERE d.company_id = $1 AND d.id = $2`,
    [ctx.companyId, delivery.delivery_id],
  );

  assert.equal(listed.rowCount, 1);
  assert.equal(listed.rows[0].status, 'posted');
  assert.ok(listed.rows[0].customer_name);
  assert.ok(listed.rows[0].order_no);
});
