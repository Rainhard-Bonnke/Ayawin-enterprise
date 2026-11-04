const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");
const inventory = require("../../src/services/inventoryService");
const stockAdjustments = require("../../src/services/stockAdjustmentService");

async function makeConfirmedOrder(ctx, customerId, itemId, quantity) {
  const order = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    requiredDate: new Date().toISOString().slice(0, 10),
    lines: [{ item_id: itemId, quantity, unit_price: 70 }],
  });
  const confirmed = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
  assert.equal(confirmed.ok, true);
  const line = await pool.query("SELECT id,item_id FROM erp_sales_order_lines WHERE sales_order_id=$1", [order.id]);
  return { order, line: line.rows[0] };
}

test("delivery ignores client unit_cost and posts inventory-derived COGS", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const { order, line } = await makeConfirmedOrder(ctx, customerId, itemId, 1);
  const delivered = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: order.id,
    warehouseId: ctx.warehouseId,
    lines: [{ so_line_id: line.id, item_id: itemId, quantity: 1, unit_cost: 0.01 }],
  });
  const issue = await pool.query(
    `SELECT unit_cost FROM erp_stock_ledger WHERE company_id=$1 AND reference_type='delivery_note'
     AND reference_id=$2 AND item_id=$3 AND movement_type='issue'`,
    [ctx.companyId, delivered.delivery_id, itemId],
  );
  assert.equal(issue.rowCount, 1);
  assert.ok(Math.abs(Number(issue.rows[0].unit_cost) - 0.01) > 0.1, "COGS must not use the client-supplied cost");
  assert.ok(Math.abs(Number(delivered.cogs_total) - Number(issue.rows[0].unit_cost)) < 0.01);
});

test("failed delivery posting leaves no committed draft delivery note", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const { order, line } = await makeConfirmedOrder(ctx, customerId, itemId, 1);
  await assert.rejects(() => sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: order.id,
    warehouseId: ctx.warehouseId,
    deliveryDate: "1900-01-01",
    lines: [{ so_line_id: line.id, item_id: itemId, quantity: 1 }],
  }));
  const drafts = await pool.query(
    "SELECT COUNT(*)::int AS count FROM erp_delivery_notes WHERE company_id=$1 AND sales_order_id=$2 AND status='draft'",
    [ctx.companyId, order.id],
  );
  assert.equal(drafts.rows[0].count, 0);
});

test("valuation reconciliation reports item values and the inventory control balance", async () => {
  const ctx = await getTestContext();
  const asOf = new Date().toISOString().slice(0, 10);
  const result = await inventory.getValuationReconciliation(ctx.companyId, asOf);
  assert.equal(result.as_of, asOf);
  assert.equal(result.inventory_account, "1300");
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.every((item) => Number.isFinite(item.stock_value)));
  assert.ok(Number.isFinite(result.stock_value));
  assert.ok(Number.isFinite(result.gl_value));
  assert.equal(result.stock_value - result.gl_value, result.variance);
  assert.ok(result.unposted_movement_types.some((movement) => movement.reference_type === "material_issue"));
});

test("posted stock adjustments update stock and inventory GL by the same value", async () => {
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const stock = await pool.query(
    `SELECT s.quantity,s.avg_unit_cost FROM erp_stock_on_hand s
     WHERE s.company_id=$1 AND s.warehouse_id=$2 AND s.item_id=$3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  const reviewer = await pool.query(
    "SELECT id FROM erp_users WHERE company_id=$1 AND is_deleted=FALSE AND id<>$2 ORDER BY created_at DESC LIMIT 1",
    [ctx.companyId, ctx.userId],
  );
  assert.ok(reviewer.rowCount, "the test company needs a second user for adjustment approval");
  const before = await inventory.getValuationReconciliation(ctx.companyId, new Date().toISOString().slice(0, 10));
  const batchNo = `E2E-ADJ-${Date.now()}`;
  const adjustment = await stockAdjustments.create({
    companyId: ctx.companyId,
    user: { id: ctx.userId },
    warehouseId: ctx.warehouseId,
    reason: "Reconciliation regression fixture",
    lines: [{ item_id: itemId, physical_quantity: Number(stock.rows[0].quantity) + 1,
      unit_cost: Number(stock.rows[0].avg_unit_cost), batch_no: batchNo, expiry_date: "2099-12-31" }],
  });
  await stockAdjustments.post({ companyId: ctx.companyId, id: adjustment.id,
    user: { id: reviewer.rows[0].id }, note: "Reconciliation regression fixture" });
  const after = await inventory.getValuationReconciliation(ctx.companyId, new Date().toISOString().slice(0, 10));
  const stockDelta = after.stock_value - before.stock_value;
  const glDelta = after.gl_value - before.gl_value;
  assert.ok(Math.abs(stockDelta - glDelta) < 0.02, `stock delta ${stockDelta} must match GL delta ${glDelta}`);
  const posted = await pool.query("SELECT journal_id,status FROM erp_stock_adjustments WHERE id=$1", [adjustment.id]);
  assert.equal(posted.rows[0].status, "posted");
  assert.ok(posted.rows[0].journal_id);
});
