const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getCustomerId, getItemId, pool } = require('./helpers');
const sales = require('../../src/services/salesService');
const { buildInvoiceVerificationHash } = require('../../src/services/documentVerificationService');

test('E2E sales flow: SO confirm -> delivery -> invoice -> payment', async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const so = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 10, unit_price: 70 }],
  });

  const confirm = await sales.confirmSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    orderId: so.id,
  });
  assert.equal(confirm.ok, true);

  const sol = await pool.query(
    'SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1',
    [so.id],
  );

  const delivery = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: so.id,
    warehouseId: ctx.warehouseId,
    lines: [{ so_line_id: sol.rows[0].id, item_id: itemId, quantity: 10 }],
  });
  assert.equal(delivery.ok, true);

  const invoice = await sales.createCustomerInvoice({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    salesOrderId: so.id,
    lines: [{ item_id: itemId, quantity: 10, unit_price: 70, so_line_id: sol.rows[0].id }],
  });
  assert.equal(invoice.ok, true);

  const inv = await pool.query(
    `SELECT id, status, total_amount, amount_paid FROM erp_customer_invoices WHERE sales_order_id = $1`,
    [so.id],
  );
  assert.equal(inv.rows[0].status, 'posted');

  const payment = await sales.recordCustomerPayment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: inv.rows[0].id,
    amount: Number(inv.rows[0].total_amount),
    notes: 'E2E full payment',
  });
  assert.equal(payment.ok, true);
  assert.equal(payment.status, 'paid');

  const paidInvoice = await pool.query(
    `SELECT status, amount_paid, total_amount FROM erp_customer_invoices WHERE id = $1`,
    [inv.rows[0].id],
  );
  assert.equal(paidInvoice.rows[0].status, 'paid');
  assert.equal(Number(paidInvoice.rows[0].amount_paid), Number(paidInvoice.rows[0].total_amount));

  const receipt = await pool.query(
    `SELECT r.amount
     FROM erp_customer_receipts r
     JOIN erp_receipt_allocations ra ON ra.receipt_id = r.id
     WHERE r.company_id = $1 AND ra.invoice_id = $2
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.ok(receipt.rowCount > 0);
  assert.equal(Number(receipt.rows[0].amount), Number(paidInvoice.rows[0].total_amount));

  const verifySource = await pool.query(
    `SELECT company_id, invoice_no, customer_id, invoice_date, total_amount, status
     FROM erp_customer_invoices
     WHERE id = $1`,
    [inv.rows[0].id],
  );
  const verificationHash = buildInvoiceVerificationHash(verifySource.rows[0]);
  assert.match(verificationHash, /^[a-f0-9]{64}$/);

  const tamperedHash = buildInvoiceVerificationHash({
    ...verifySource.rows[0],
    total_amount: Number(verifySource.rows[0].total_amount) + 1,
  });
  assert.notEqual(tamperedHash, verificationHash);
});
