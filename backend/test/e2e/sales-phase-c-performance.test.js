const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");
const creditNotes = require("../../src/services/customerCreditNoteService");
const performance = require("../../src/services/salesPerformanceService");

test("sales target and commission reflect posted invoice less posted customer return", async () => {
  const context = await getTestContext();
  const customerId = await getCustomerId(context.companyId, "CCRM-PERF");
  const itemId = await getItemId(context.companyId, "COKE-500");
  const today = new Date().toISOString().slice(0, 10);
  const runId = crypto.randomUUID().replace(/-/g, "");
  const role = await pool.query(
    `SELECT id FROM erp_roles WHERE company_id=$1 AND name='Sales Rep' LIMIT 1`,
    [context.companyId],
  );
  const fallbackRole = role.rowCount ? role.rows[0].id : (await pool.query(
    `SELECT id FROM erp_roles WHERE company_id=$1 AND name='System Administrator' LIMIT 1`,
    [context.companyId],
  )).rows[0].id;
  const seller = await pool.query(
    `INSERT INTO erp_users (
       company_id, default_branch_id, role_id, username, email, full_name, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,'Phase C Sales Rep','active',$6)
     RETURNING id`,
    [context.companyId, context.branchId, fallbackRole,
      `phase-c-${runId}`, `phase-c-${runId}@example.test`, context.userId],
  );
  const salesRepId = seller.rows[0].id;
  const stockBefore = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`,
    [context.companyId, context.warehouseId, itemId],
  );
  const initialQuantity = Number(stockBefore.rows[0]?.quantity || 0);

  const order = await sales.createSalesOrder({
    companyId: context.companyId,
    userId: context.userId,
    salesRepId,
    customerId,
    warehouseId: context.warehouseId,
    orderDate: today,
    requiredDate: today,
    lines: [{ item_id: itemId, quantity: 10, unit_price: 70 }],
  });
  assert.equal(order.sales_rep_id, salesRepId);
  assert.equal((await sales.confirmSalesOrder({ companyId: context.companyId, userId: context.userId, orderId: order.id })).ok, true);

  const orderLine = await pool.query(
    `SELECT id FROM erp_sales_order_lines WHERE company_id=$1 AND sales_order_id=$2 LIMIT 1`,
    [context.companyId, order.id],
  );
  const pickList = await sales.createSalesPickList({
    companyId: context.companyId,
    userId: context.userId,
    salesOrderId: order.id,
  });
  assert.equal(pickList.status, "open");
  assert.equal(pickList.lines.length, 1);
  await assert.rejects(
    () => sales.recordSalesPicks({
      companyId: context.companyId,
      userId: context.userId,
      pickListId: pickList.id,
      lines: [{ pick_list_line_id: pickList.lines[0].id, quantity_picked: 9 }],
    }),
    /full required quantity for every pick-list line/,
  );
  await sales.recordSalesPicks({
    companyId: context.companyId,
    userId: context.userId,
    pickListId: pickList.id,
    lines: [{ pick_list_line_id: pickList.lines[0].id, quantity_picked: 10 }],
  });
  const delivery = await sales.createAndPostDelivery({
    companyId: context.companyId,
    userId: context.userId,
    salesOrderId: order.id,
    warehouseId: context.warehouseId,
    lines: [{ so_line_id: orderLine.rows[0].id, item_id: itemId, quantity: 10 }],
    deliveryDate: today,
    pickListId: pickList.id,
  });
  const deliveredPickList = await sales.getSalesPickList({ companyId: context.companyId, pickListId: pickList.id });
  assert.equal(deliveredPickList.status, "fulfilled");
  const invoice = await sales.createCustomerInvoice({
    companyId: context.companyId,
    userId: context.userId,
    customerId,
    salesOrderId: order.id,
    deliveryNoteId: delivery.delivery_id,
    invoiceDate: today,
    lines: [{ item_id: itemId, quantity: 10, unit_price: 70, so_line_id: orderLine.rows[0].id }],
  });
  assert.equal(invoice.ok, true);
  const invoiceRow = (await pool.query(
    `SELECT id, subtotal, sales_rep_id, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date
     FROM erp_customer_invoices
     WHERE company_id=$1 AND sales_order_id=$2`,
    [context.companyId, order.id],
  )).rows[0];
  assert.equal(invoiceRow.sales_rep_id, salesRepId);
  const performanceDate = invoiceRow.invoice_date;

  const returnOptions = await creditNotes.getReturnOptions(context.companyId, invoiceRow.id);
  const returnedLine = returnOptions.lines[0];
  const creditDraft = await creditNotes.createDraft({
    companyId: context.companyId,
    user: { id: context.userId },
    invoiceId: invoiceRow.id,
    creditDate: performanceDate,
    reason: "Phase C sales performance regression",
    lines: [{
      invoice_line_id: returnedLine.invoice_line_id,
      delivery_note_line_id: returnedLine.delivery_note_line_id,
      source_layer_id: returnedLine.source_layer_id,
      batch_no: returnedLine.batch_no,
      expiry_date: returnedLine.expiry_date,
      quantity: 2,
      condition: "good",
    }],
  });
  const postedCredit = await creditNotes.postCreditNote({
    companyId: context.companyId,
    noteId: creditDraft.id,
    user: { id: context.reviewerId },
  });
  assert.equal(postedCredit.status, "posted");
  const creditRow = (await pool.query(
    `SELECT subtotal FROM erp_customer_credit_notes WHERE company_id=$1 AND id=$2`,
    [context.companyId, postedCredit.id],
  )).rows[0];

  const afterReturnStock = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`,
    [context.companyId, context.warehouseId, itemId],
  );
  assert.equal(Number(afterReturnStock.rows[0].quantity), initialQuantity - 8);

  await performance.saveSalesTarget({
    companyId: context.companyId,
    userId: context.userId,
    salesRepId,
    periodStart: performanceDate,
    periodEnd: performanceDate,
    targetAmount: 500,
  });
  await performance.createCommissionPlan({
    companyId: context.companyId,
    userId: context.userId,
    code: "E2E-PHASE-C-GOLDEN",
    name: "Phase C E2E commission",
    ratePercent: 5,
    effectiveFrom: performanceDate,
    effectiveTo: performanceDate,
  });
  const rows = await performance.getSalesPerformance({
    companyId: context.companyId,
    periodStart: performanceDate,
    periodEnd: performanceDate,
    salesRepId,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net_sales, Number(invoiceRow.subtotal) - Number(creditRow.subtotal));
  assert.equal(rows[0].attainment_percent, 112);
  assert.equal(rows[0].commission_amount, 28);
  assert.equal(rows[0].invoice_count, 1);
  assert.equal(rows[0].credit_note_count, 1);
});