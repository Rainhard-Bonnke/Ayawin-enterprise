const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getTestContext, getVendorId, pool } = require("./helpers");
const stocktakes = require("../../src/services/stocktakeService");
const procurement = require("../../src/services/procurementService");

async function createCountWarehouse(context, code) {
  return pool.query(
    `INSERT INTO erp_warehouses (company_id, branch_id, code, name, is_active, is_deleted)
     VALUES ($1,$2,$3,$4,TRUE,FALSE) RETURNING id`,
    [context.companyId, context.branchId, code, `Stocktake E2E ${code}`],
  );
}

async function receiveQty(context, vendorId, warehouseId, itemId, quantity) {
  const order = await procurement.createPurchaseOrder({
    companyId: context.companyId, userId: context.userId, vendorId, warehouseId,
    lines: [{ item_id: itemId, quantity, unit_cost: 100 }],
  });
  await procurement.approvePurchaseOrder({ companyId: context.companyId, userId: context.userId, poId: order.id });
  const line = (await pool.query(`SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id=$1`, [order.id])).rows[0];
  return procurement.createAndPostGrn({
    companyId: context.companyId, userId: context.userId, purchaseOrderId: order.id, warehouseId,
    lines: [{ po_line_id: line.id, item_id: itemId, quantity, unit_cost: 100 }],
  });
}

test("stocktake requires an independent reviewer before posting variances", async () => {
  const context = await getTestContext();
  const item = await pool.query(
    `SELECT id FROM erp_items
     WHERE company_id=$1 AND is_stock_item=TRUE AND is_active=TRUE AND is_deleted=FALSE
       AND lot_tracking_enabled=FALSE
     ORDER BY item_code LIMIT 1`,
    [context.companyId],
  );
  assert.ok(item.rowCount, "test fixture needs one active non-lot-tracked item");
  const code = `SC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const warehouse = await createCountWarehouse(context, code);
  const vendorId = await getVendorId(context.companyId, `V-${code}`);
  await receiveQty(context, vendorId, warehouse.rows[0].id, item.rows[0].id, 1);
  const session = await stocktakes.startStocktake({
    companyId: context.companyId,
    warehouseId: warehouse.rows[0].id,
    title: "Maker-checker stocktake test",
    user: { id: context.userId, role_name: "System Administrator" },
  });
  const detail = await stocktakes.getStocktake(context.companyId, session.id,
    { id: context.userId, role_name: "System Administrator" }, { includeExpected: true });
  const counts = detail.lines.map((line) => ({
    line_id: line.id,
    counted_quantity: line.item_id === item.rows[0].id ? 2 : Number(line.expected_quantity || 0),
  }));
  await stocktakes.submitStocktake({
    companyId: context.companyId,
    stocktakeId: session.id,
    counts,
    user: { id: context.userId, role_name: "System Administrator" },
  });

  await assert.rejects(
    () => stocktakes.reviewStocktake({
      companyId: context.companyId,
      stocktakeId: session.id,
      decision: "approve",
      user: { id: context.userId, role_name: "System Administrator" },
    }),
    /submitter cannot review or post/i,
  );

  const posted = await stocktakes.reviewStocktake({
    companyId: context.companyId,
    stocktakeId: session.id,
    decision: "approve",
    note: "Independent E2E approval",
    user: { id: context.reviewerId, role_name: "System Administrator" },
  });
  assert.equal(posted.status, "posted");
  assert.ok(posted.journal_id);
  const onHand = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`,
    [context.companyId, warehouse.rows[0].id, item.rows[0].id],
  );
  assert.equal(Number(onHand.rows[0].quantity), 2);
});

test("stock movement after submission requires a same-session recount with a fresh snapshot", async () => {
  const context = await getTestContext();
  const item = (await pool.query(
    `SELECT id FROM erp_items WHERE company_id=$1 AND is_stock_item=TRUE AND is_active=TRUE
       AND is_deleted=FALSE AND lot_tracking_enabled=FALSE ORDER BY item_code LIMIT 1`,
    [context.companyId],
  )).rows[0];
  assert.ok(item);
  const code = `SCR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const warehouse = await createCountWarehouse(context, code);
  const vendorId = await getVendorId(context.companyId, `V-${code}`);
  await receiveQty(context, vendorId, warehouse.rows[0].id, item.id, 1);
  const maker = { id: context.userId, role_name: "System Administrator" };
  const reviewer = { id: context.reviewerId, role_name: "System Administrator" };
  const session = await stocktakes.startStocktake({
    companyId: context.companyId, warehouseId: warehouse.rows[0].id, title: "Recount snapshot regression", user: maker,
  });
  let detail = await stocktakes.getStocktake(context.companyId, session.id, maker, { includeExpected: true });
  await stocktakes.submitStocktake({
    companyId: context.companyId, stocktakeId: session.id,
    counts: detail.lines.map((line) => ({ line_id: line.id, counted_quantity: Number(line.expected_quantity || 0) })),
    user: maker,
  });
  await receiveQty(context, vendorId, warehouse.rows[0].id, item.id, 1);
  const review = await stocktakes.reviewStocktake({
    companyId: context.companyId, stocktakeId: session.id, decision: "approve", user: reviewer,
  });
  assert.equal(review.status, "recount_required");

  const reopened = await stocktakes.reopenStocktakeForRecount({ companyId: context.companyId, stocktakeId: session.id, user: maker });
  assert.equal(reopened.status, "counting");
  detail = await stocktakes.getStocktake(context.companyId, session.id, maker, { includeExpected: true });
  const itemLine = detail.lines.find((line) => line.item_id === item.id);
  assert.equal(Number(itemLine.expected_quantity), 2);
  assert.equal(itemLine.counted_quantity, null);
  const submitted = await stocktakes.submitStocktake({
    companyId: context.companyId, stocktakeId: session.id,
    counts: detail.lines.map((line) => ({ line_id: line.id, counted_quantity: Number(line.expected_quantity || 0) })),
    user: maker,
  });
  assert.equal(submitted.status, "submitted");
  const posted = await stocktakes.reviewStocktake({ companyId: context.companyId, stocktakeId: session.id, decision: "approve", user: reviewer });
  assert.equal(posted.status, "posted");
  assert.equal(posted.journal_id, null);
});
