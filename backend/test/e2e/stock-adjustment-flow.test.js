const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getItemId, pool } = require('./helpers');
const adjustments = require('../../src/services/inventoryAdjustmentService');

test('E2E stock adjustment: draft -> post updates quantity', async () => {
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, 'TSK-500');

  const before = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  const qtyBefore = Number(before.rows[0]?.quantity || 0);

  const adj = await adjustments.createStockAdjustment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    warehouseId: ctx.warehouseId,
    reason: 'E2E cycle count variance',
    lines: [{ item_id: itemId, quantity_delta: 2, unit_cost: 10 }],
  });
  assert.equal(adj.status, 'draft');

  await adjustments.postStockAdjustment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    adjustmentId: adj.id,
    approverId: ctx.userId,
  });

  const after = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  assert.equal(Number(after.rows[0].quantity), qtyBefore + 2);
});
