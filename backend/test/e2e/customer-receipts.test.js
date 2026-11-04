const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getCustomerId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");
const receipts = require("../../src/services/customerReceiptService");

async function makeInvoice(ctx, customerId) {
  const invoiceNo = `E2E-RCP-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const result = await pool.query(
    `INSERT INTO erp_customer_invoices (company_id,customer_id,invoice_no,invoice_date,due_date,status,subtotal,total_amount,created_by)
     VALUES ($1,$2,$3,CURRENT_DATE,CURRENT_DATE+30,'posted',100,100,$4) RETURNING id`,
    [ctx.companyId, customerId, invoiceNo, ctx.userId],
  );
  return { id: result.rows[0].id, invoiceNo };
}

test("an M-Pesa receipt reference cannot be recorded twice for one company", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const first = await makeInvoice(ctx, customerId);
  const second = await makeInvoice(ctx, customerId);
  const receiptReference = `E2E-MPESA-${Date.now()}`;
  try {
    await sales.recordCustomerPayment({ companyId: ctx.companyId, userId: ctx.userId, invoiceId: first.id,
      amount: 10, referenceNo: receiptReference, paymentMethod: "mpesa", postGl: false });
    await assert.rejects(() => sales.recordCustomerPayment({ companyId: ctx.companyId, userId: ctx.userId,
      invoiceId: second.id, amount: 10, referenceNo: receiptReference, paymentMethod: "mpesa", postGl: false }));
  } finally {
    await pool.query("DELETE FROM erp_customer_receipts WHERE company_id=$1 AND reference_no=$2", [ctx.companyId, receiptReference]);
    await pool.query("UPDATE erp_customer_invoices SET is_deleted=TRUE WHERE id=ANY($1::uuid[])", [[first.id, second.id]]);
  }
});

test("receipt retry with one idempotency key posts once to the mapped M-Pesa account", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const idempotencyKey = `E2E-IDEMP-${Date.now()}`;
  const request = { companyId: ctx.companyId, userId: ctx.userId, customerId, amount: 1.23,
    paymentMethod: "mpesa", referenceNo: `E2E-MPESA-RETRY-${Date.now()}`, idempotencyKey };
  const [first, retry] = await Promise.all([
    receipts.createCustomerReceipt(request), receipts.createCustomerReceipt(request),
  ]);
  assert.equal(first.receipt_id, retry.receipt_id);
  assert.equal(first.journal_id, retry.journal_id);
  assert.equal(retry.idempotent, true);
  const lines = await pool.query(
    `SELECT account.account_code,line.debit,line.credit FROM erp_journal_lines line
     JOIN erp_chart_of_accounts account ON account.id=line.account_id
     WHERE line.journal_id=$1 ORDER BY line.debit DESC`, [first.journal_id],
  );
  assert.equal(lines.rows.find((line) => Number(line.debit) > 0).account_code, "1120");
  assert.equal(lines.rows.reduce((sum, line) => sum + Number(line.debit), 0), 1.23);
});

test("closing a POS till posts a signed cash over/short journal", async () => {
  const ctx = await getTestContext();
  const session = await receipts.openTillSession({ companyId: ctx.companyId, userId: ctx.userId, openingFloat: 10 });
  const closed = await receipts.closeTillSession({ companyId: ctx.companyId, userId: ctx.userId,
    sessionId: session.id, countedCash: 8.5 });
  assert.equal(Number(closed.variance), -1.5);
  assert.ok(closed.closing_journal_id);
  const lines = await pool.query(
    `SELECT account.account_code,line.debit,line.credit FROM erp_journal_lines line
     JOIN erp_chart_of_accounts account ON account.id=line.account_id
     WHERE line.journal_id=$1`, [closed.closing_journal_id],
  );
  assert.equal(Number(lines.rows.find((line) => line.account_code==="5300").debit), 1.5);
  assert.equal(Number(lines.rows.find((line) => line.account_code==="1110").credit), 1.5);
});
