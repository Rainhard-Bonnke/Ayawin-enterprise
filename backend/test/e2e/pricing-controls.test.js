const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");

test("a tampered client price is rejected unless the creator has price override permission", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  await assert.rejects(() => sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    requiredDate: new Date().toISOString().slice(0, 10),
    lines: [{ item_id: itemId, quantity: 1, unit_price: 0.01 }],
  }), /price override/i);
});

test("authorized price overrides retain the list price in the audit trail", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const listed = await pool.query(
    `SELECT entry.unit_price FROM erp_price_list_items entry
     JOIN erp_price_lists list ON list.id=entry.price_list_id
     WHERE list.company_id=$1 AND list.is_default=TRUE AND list.is_active=TRUE AND entry.item_id=$2
       AND list.effective_from<=CURRENT_DATE AND (list.effective_to IS NULL OR list.effective_to>=CURRENT_DATE)
     ORDER BY entry.min_qty DESC LIMIT 1`, [ctx.companyId, itemId]);
  assert.ok(listed.rowCount);
  const listPrice = Number(listed.rows[0].unit_price);
  const order = await sales.createSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, customerId,
    warehouseId: ctx.warehouseId, requiredDate: new Date().toISOString().slice(0, 10),
    permissions: ["sales.price_override"], lines: [{ item_id: itemId, quantity: 1, unit_price: listPrice - 1 }] });
  const audit = await pool.query(
    `SELECT old_values,new_values FROM erp_audit_log
     WHERE company_id=$1 AND entity_id=$2 AND action='sales_price_overridden' ORDER BY created_at DESC LIMIT 1`,
    [ctx.companyId, order.id]);
  assert.equal(Number(audit.rows[0].old_values.list_unit_price), listPrice);
  assert.equal(Number(audit.rows[0].new_values.unit_price), listPrice - 1);
});

test("orders with above-limit discounts require approval by a different user", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const order = await sales.createSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, customerId,
    warehouseId: ctx.warehouseId, requiredDate: new Date().toISOString().slice(0, 10),
    lines: [{ item_id: itemId, quantity: 1, discount_percent: 15 }] });
  assert.equal(order.discount_approval_status, "pending");
  const confirmation = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
  assert.equal(confirmation.reason, "discount_approval_required");
  await assert.rejects(() => sales.approveSalesOrderDiscount({ companyId: ctx.companyId, userId: ctx.userId,
    orderId: order.id, reason: "Self approval must fail" }), /cannot approve their own/i);
  const reviewer = await pool.query(
    "SELECT id FROM erp_users WHERE company_id=$1 AND is_deleted=FALSE AND id<>$2 ORDER BY created_at DESC LIMIT 1",
    [ctx.companyId, ctx.userId]);
  const approved = await sales.approveSalesOrderDiscount({ companyId: ctx.companyId, userId: reviewer.rows[0].id,
    orderId: order.id, reason: "Approved promotional discount" });
  assert.equal(approved.discount_approval_status, "approved");
  const audit = await pool.query(
    "SELECT 1 FROM erp_audit_log WHERE company_id=$1 AND entity_id=$2 AND action='sales_discount_approved'",
    [ctx.companyId, order.id]);
  assert.equal(audit.rowCount, 1);
});
