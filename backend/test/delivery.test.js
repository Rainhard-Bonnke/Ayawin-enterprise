const test = require('node:test');
const assert = require('node:assert/strict');
const delivery = require('../src/services/deliveryService');

test('resolveDeliveryZone — Nairobi Westlands', () => {
  const z = delivery.resolveDeliveryZone({ city: 'Nairobi', address_line1: '14 Waiyaki Way, Westlands' });
  assert.equal(z.code, 'nairobi_westlands');
  assert.equal(z.group, 'nairobi');
});

test('resolveDeliveryZone — upcountry Kisumu', () => {
  const z = delivery.resolveDeliveryZone({ city: 'Kisumu', address_line1: 'Oginga Odinga St' });
  assert.equal(z.group, 'upcountry');
});

test('delivery logistics with DB', async () => {
  const { getTestContext, getCustomerId, getItemId, pool } = require('./e2e/helpers');
  const sales = require('../src/services/salesService');
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const so = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 2, unit_price: 70 }],
  });
  await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: so.id });
  const sol = await pool.query('SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1', [so.id]);

  const emp = await pool.query(
    `SELECT id FROM erp_employees WHERE company_id = $1 AND is_active = TRUE LIMIT 1`,
    [ctx.companyId],
  );
  const driverId = emp.rows[0]?.id;

  const result = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: so.id,
    warehouseId: ctx.warehouseId,
    lines: [{ so_line_id: sol.rows[0].id, item_id: itemId, quantity: 2 }],
    driverId,
  });
  assert.equal(result.ok, true);

  const dn = await delivery.getDelivery(ctx.companyId, result.delivery_id);
  assert.equal(dn.sales_order_id, so.id);
  assert.ok(dn.delivery_zone);
  assert.equal(dn.logistics_status, 'delivered');

  const soAfter = await pool.query('SELECT status FROM erp_sales_orders WHERE id = $1', [so.id]);
  assert.ok(['delivered', 'partial', 'invoiced'].includes(soAfter.rows[0].status));

  if (driverId) {
    const active = await delivery.getDriverActiveDeliveries(ctx.companyId, driverId);
    assert.equal(active.filter((d) => d.id === result.delivery_id).length, 0);
  }

  const routes = await delivery.optimizeRoutes(ctx.companyId);
  assert.ok(Array.isArray(routes.routes));
});
