const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");

async function setCreditFixtures(ctx, customerId, limit) {
  const customer = await pool.query("SELECT credit_limit,credit_hold FROM erp_customers WHERE id=$1", [customerId]);
  const days = await pool.query("SELECT setting_value FROM erp_system_settings WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'", [ctx.companyId]);
  await pool.query("UPDATE erp_customers SET credit_limit=$2 WHERE id=$1", [customerId, limit]);
  await pool.query("UPDATE erp_system_settings SET setting_value='36500'::jsonb WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'", [ctx.companyId]);
  return async () => {
    await pool.query("UPDATE erp_customers SET credit_limit=$2,credit_hold=$3 WHERE id=$1", [customerId, customer.rows[0].credit_limit, customer.rows[0].credit_hold]);
    await pool.query("UPDATE erp_system_settings SET setting_value=$2::jsonb WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'", [ctx.companyId, JSON.stringify(days.rows[0].setting_value)]);
  };
}

test("concurrent confirmations serialize credit exposure for the same customer", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const original = await pool.query("SELECT credit_limit FROM erp_customers WHERE id=$1", [customerId]);
  const originalOverdue = await pool.query(
    "SELECT setting_value FROM erp_system_settings WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'",
    [ctx.companyId]);
  const baseline = await sales.checkCreditLimit(ctx.companyId, customerId, 0);
  const draftOrder = () => sales.createSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, customerId,
    warehouseId: ctx.warehouseId, requiredDate: new Date().toISOString().slice(0, 10),
    lines: [{ item_id: itemId, quantity: 1 }] });
  const orders = await Promise.all([draftOrder(), draftOrder()]);
  try {
    const orderValue = Number(orders[0].total_amount);
    await pool.query("UPDATE erp_customers SET credit_limit=$2 WHERE id=$1", [customerId, baseline.exposure + orderValue * 1.5]);
    await pool.query(
      "UPDATE erp_system_settings SET setting_value='36500'::jsonb WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'",
      [ctx.companyId]);
    const results = await Promise.all(orders.map((order) => sales.confirmSalesOrder({
      companyId: ctx.companyId, userId: ctx.userId, orderId: order.id,
    })));
    assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
    assert.equal(results.filter((result) => result.reason === "credit_limit_exceeded").length, 1, JSON.stringify(results));
  } finally {
    await pool.query("UPDATE erp_customers SET credit_limit=$2 WHERE id=$1", [customerId, original.rows[0].credit_limit]);
    await pool.query(
      "UPDATE erp_system_settings SET setting_value=$2::jsonb WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'",
      [ctx.companyId, JSON.stringify(originalOverdue.rows[0].setting_value)]);
  }
});

test("delivered but uninvoiced goods remain in customer credit exposure", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const restore = await setCreditFixtures(ctx, customerId, 999999999);
  try {
    const order = await sales.createSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, customerId,
      warehouseId: ctx.warehouseId, requiredDate: new Date().toISOString().slice(0, 10),
      lines: [{ item_id: itemId, quantity: 1 }] });
    const confirmed = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
    assert.equal(confirmed.ok, true);
    const before = await sales.checkCreditLimit(ctx.companyId, customerId, 0);
    const line = await pool.query("SELECT id,item_id FROM erp_sales_order_lines WHERE sales_order_id=$1", [order.id]);
    await sales.createAndPostDelivery({ companyId: ctx.companyId, userId: ctx.userId, salesOrderId: order.id,
      warehouseId: ctx.warehouseId, lines: [{ so_line_id: line.rows[0].id, item_id: itemId, quantity: 1 }] });
    const after = await sales.checkCreditLimit(ctx.companyId, customerId, 0);
    assert.ok(before.breakdown.confirmed_orders >= Number(order.total_amount));
    assert.ok(after.breakdown.delivered_uninvoiced >= Number(order.total_amount));
    assert.ok(after.breakdown.confirmed_orders < before.breakdown.confirmed_orders);
  } finally { await restore(); }
});

test("credit overrides require a different approver, expire, and are audited", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const restore = await setCreditFixtures(ctx, customerId, 0);
  try {
    const order = await sales.createSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, customerId,
      warehouseId: ctx.warehouseId, requiredDate: new Date().toISOString().slice(0, 10),
      lines: [{ item_id: itemId, quantity: 1 }] });
    const blocked = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
    assert.equal(blocked.reason, "credit_limit_exceeded");
    const reviewer = await pool.query("SELECT id FROM erp_users WHERE company_id=$1 AND id<>$2 AND is_deleted=FALSE ORDER BY created_at DESC LIMIT 1", [ctx.companyId, ctx.userId]);
    await assert.rejects(() => sales.approveSalesOrderCreditOverride({ companyId: ctx.companyId, userId: ctx.userId,
      orderId: order.id, reason: "Self approval" }), /cannot approve their own/i);
    const approved = await sales.approveSalesOrderCreditOverride({ companyId: ctx.companyId, userId: reviewer.rows[0].id,
      orderId: order.id, reason: "Temporary customer credit exception" });
    assert.ok(new Date(approved.credit_override_expires_at) > new Date());
    const confirmed = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
    assert.equal(confirmed.ok, true);
    const audit = await pool.query("SELECT COUNT(*)::int AS n FROM erp_audit_log WHERE entity_id=$1 AND action IN ('sales_credit_override_approved','sales_credit_override_used')", [order.id]);
    assert.equal(audit.rows[0].n, 2);
  } finally { await restore(); }
});

test("manual customer credit hold blocks both order confirmation and delivery", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const restore = await setCreditFixtures(ctx, customerId, 999999999);
  try {
    const order = await sales.createSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, customerId,
      warehouseId: ctx.warehouseId, requiredDate: new Date().toISOString().slice(0, 10), lines: [{ item_id: itemId, quantity: 1 }] });
    await pool.query("UPDATE erp_customers SET credit_hold=TRUE WHERE id=$1", [customerId]);
    const held = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
    assert.equal(held.reason, "customer_credit_hold");
    await pool.query("UPDATE erp_customers SET credit_hold=FALSE WHERE id=$1", [customerId]);
    const confirmed = await sales.confirmSalesOrder({ companyId: ctx.companyId, userId: ctx.userId, orderId: order.id });
    assert.equal(confirmed.ok, true);
    const line = await pool.query("SELECT id,item_id FROM erp_sales_order_lines WHERE sales_order_id=$1", [order.id]);
    await pool.query("UPDATE erp_customers SET credit_hold=TRUE WHERE id=$1", [customerId]);
    await assert.rejects(() => sales.createAndPostDelivery({ companyId: ctx.companyId, userId: ctx.userId,
      salesOrderId: order.id, warehouseId: ctx.warehouseId,
      lines: [{ so_line_id: line.rows[0].id, item_id: itemId, quantity: 1 }] }), /manual credit hold/i);
    const draft = await pool.query("SELECT COUNT(*)::int AS n FROM erp_delivery_notes WHERE sales_order_id=$1 AND status='draft'", [order.id]);
    assert.equal(draft.rows[0].n, 0);
  } finally { await restore(); }
});

test("overdue invoices block credit according to the company threshold", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const invoiceNo = `E2E-OVERDUE-${Date.now()}`;
  const restore = await setCreditFixtures(ctx, customerId, 999999999);
  try {
    await pool.query(
      `INSERT INTO erp_customer_invoices (company_id,customer_id,invoice_no,invoice_date,due_date,status,subtotal,total_amount,created_by)
       VALUES ($1,$2,$3,CURRENT_DATE,CURRENT_DATE-60,'posted',100,100,$4)`,
      [ctx.companyId, customerId, invoiceNo, ctx.userId]);
    await pool.query("UPDATE erp_system_settings SET setting_value='30'::jsonb WHERE company_id=$1 AND category='sales' AND setting_key='overdue_block_days'", [ctx.companyId]);
    const result = await sales.checkCreditLimit(ctx.companyId, customerId, 0);
    assert.equal(result.overdue_blocked, true);
    assert.equal(result.overdue_days, 30);
    assert.equal(result.ok, false);
  } finally {
    await pool.query("DELETE FROM erp_customer_invoices WHERE company_id=$1 AND invoice_no=$2", [ctx.companyId, invoiceNo]);
    await restore();
  }
});
