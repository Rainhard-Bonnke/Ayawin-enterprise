const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getVendorId, getItemId, pool } = require("./helpers");
const procurement = require("../../src/services/procurementService");

test("E2E purchase flow: PO -> GRN posts stock", async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");

  const po = await procurement.createPurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 50, unit_cost: 40 }],
  });
  assert.ok(po.po_number);

  await procurement.approvePurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    poId: po.id,
  });

  const pol = await pool.query(
    "SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id = $1 LIMIT 1",
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

test("partial GRNs post actual received quantity and can receive the remaining balance later", async () => {
  const context = await getTestContext();
  const vendorId = await getVendorId(context.companyId, "V-PARTIAL-GRN");
  const itemId = await getItemId(context.companyId, "COKE-500");
  const order = await procurement.createPurchaseOrder({
    companyId: context.companyId,
    userId: context.userId,
    vendorId,
    warehouseId: context.warehouseId,
    lines: [{ item_id: itemId, quantity: 30, unit_cost: 40 }],
  });
  await procurement.approvePurchaseOrder({ companyId: context.companyId, userId: context.userId, poId: order.id });
  const line = (await pool.query(
    `SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id=$1`,
    [order.id],
  )).rows[0];

  const first = await procurement.createAndPostGrn({
    companyId: context.companyId,
    userId: context.userId,
    purchaseOrderId: order.id,
    warehouseId: context.warehouseId,
    lines: [{ po_line_id: line.id, item_id: itemId, quantity: 12, unit_cost: 40 }],
  });
  assert.equal(first.ok, true);
  let state = await pool.query(
    `SELECT po.status, line.qty_received FROM erp_purchase_orders po
     JOIN erp_purchase_order_lines line ON line.purchase_order_id=po.id WHERE po.id=$1`,
    [order.id],
  );
  assert.equal(state.rows[0].status, "partial");
  assert.equal(Number(state.rows[0].qty_received), 12);

  const second = await procurement.createAndPostGrn({
    companyId: context.companyId,
    userId: context.userId,
    purchaseOrderId: order.id,
    warehouseId: context.warehouseId,
    lines: [{ po_line_id: line.id, item_id: itemId, quantity: 18, unit_cost: 40 }],
  });
  assert.equal(second.ok, true);
  state = await pool.query(
    `SELECT po.status, line.qty_received FROM erp_purchase_orders po
     JOIN erp_purchase_order_lines line ON line.purchase_order_id=po.id WHERE po.id=$1`,
    [order.id],
  );
  assert.equal(state.rows[0].status, "received");
  assert.equal(Number(state.rows[0].qty_received), 30);
});

test("GRN inspection quarantines held stock and rejected quantities never enter inventory", async () => {
  const context = await getTestContext();
  const vendorId = await getVendorId(context.companyId, "V-INSPECT-GRN");
  const itemId = await getItemId(context.companyId, "COKE-500");
  const item = (await pool.query(
    `SELECT lot_tracking_enabled FROM erp_items WHERE id=$1 AND company_id=$2`,
    [itemId, context.companyId],
  )).rows[0];
  const before = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`,
    [context.companyId, context.warehouseId, itemId],
  );
  const beforeQuantity = Number(before.rows[0]?.quantity || 0);
  const expiry = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const lotDetails = item.lot_tracking_enabled ? { batch_no: `INSPECT-${Date.now()}`, expiry_date: expiry } : {};

  const quarantineOrder = await procurement.createPurchaseOrder({
    companyId: context.companyId, userId: context.userId, vendorId, warehouseId: context.warehouseId,
    lines: [{ item_id: itemId, quantity: 4, unit_cost: 40 }],
  });
  await procurement.approvePurchaseOrder({ companyId: context.companyId, userId: context.userId, poId: quarantineOrder.id });
  const quarantineLine = (await pool.query(`SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id=$1`, [quarantineOrder.id])).rows[0];
  await procurement.createAndPostGrn({
    companyId: context.companyId, userId: context.userId, purchaseOrderId: quarantineOrder.id, warehouseId: context.warehouseId,
    lines: [{ po_line_id: quarantineLine.id, item_id: itemId, quantity: 4, unit_cost: 40,
      inspection_status: "quarantine", inspection_reason: "Packaging damage awaiting QA", ...lotDetails }],
  });
  const afterQuarantine = await pool.query(
    `SELECT s.quantity,
       CASE WHEN item.lot_tracking_enabled THEN COALESCE((SELECT SUM(l.quarantined_quantity) FROM erp_inventory_lots l
         WHERE l.company_id=s.company_id AND l.warehouse_id=s.warehouse_id AND l.item_id=s.item_id),0)
       ELSE COALESCE((SELECT q.quantity FROM erp_inventory_quarantine_balances q WHERE q.company_id=s.company_id
         AND q.warehouse_id=s.warehouse_id AND q.item_id=s.item_id),0) END AS quarantined
     FROM erp_stock_on_hand s JOIN erp_items item ON item.id=s.item_id
     WHERE s.company_id=$1 AND s.warehouse_id=$2 AND s.item_id=$3`,
    [context.companyId, context.warehouseId, itemId],
  );
  assert.equal(Number(afterQuarantine.rows[0].quantity), beforeQuantity + 4);
  assert.ok(Number(afterQuarantine.rows[0].quarantined) >= 4);

  const rejectedOrder = await procurement.createPurchaseOrder({
    companyId: context.companyId, userId: context.userId, vendorId, warehouseId: context.warehouseId,
    lines: [{ item_id: itemId, quantity: 3, unit_cost: 40 }],
  });
  await procurement.approvePurchaseOrder({ companyId: context.companyId, userId: context.userId, poId: rejectedOrder.id });
  const rejectedLine = (await pool.query(`SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id=$1`, [rejectedOrder.id])).rows[0];
  await procurement.createAndPostGrn({
    companyId: context.companyId, userId: context.userId, purchaseOrderId: rejectedOrder.id, warehouseId: context.warehouseId,
    lines: [{ po_line_id: rejectedLine.id, item_id: itemId, quantity: 3, unit_cost: 40,
      inspection_status: "reject", inspection_reason: "Failed quality inspection", ...lotDetails }],
  });
  const rejected = await pool.query(
    `SELECT s.quantity, po_line.qty_received, po.status
     FROM erp_stock_on_hand s JOIN erp_purchase_orders po ON po.id=$1
     JOIN erp_purchase_order_lines po_line ON po_line.purchase_order_id=po.id
     WHERE s.company_id=$2 AND s.warehouse_id=$3 AND s.item_id=$4`,
    [rejectedOrder.id, context.companyId, context.warehouseId, itemId],
  );
  assert.equal(Number(rejected.rows[0].quantity), beforeQuantity + 4);
  assert.equal(Number(rejected.rows[0].qty_received), 0);
  assert.equal(rejected.rows[0].status, "partial");
});
