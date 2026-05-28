const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getVendorId, getItemId, pool } = require('./helpers');
const procurement = require('../../src/services/procurementService');

test('E2E purchase flow: PO -> GRN posts stock', async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const po = await procurement.createPurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 50, unit_cost: 40 }],
  });
  assert.ok(po.po_number);

  await procurement.approvePurchaseOrder({ companyId: ctx.companyId, userId: ctx.userId, poId: po.id });

  const pol = await pool.query(
    'SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id = $1 LIMIT 1',
    [po.id],
  );

  const grn = await procurement.createAndPostGrn({
    companyId: ctx.companyId,
    userId: ctx.userId,
    purchaseOrderId: po.id,
    warehouseId: ctx.warehouseId,
    lines: [{ po_line_id: pol.rows[0].id, item_id: itemId, quantity: 50, unit_cost: 40 }],
  });
  assert.equal(grn.ok, true);

  const stock = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  assert.ok(Number(stock.rows[0].quantity) >= 50);
});
