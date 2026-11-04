const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");
const receipts = require("../../src/services/customerReceiptService");
const { ACCOUNT_CODES } = require("../../src/services/accountCodes");

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

test("customer statement movement matches the customer AR journal movement", async () => {
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const customer = await pool.query(
    "INSERT INTO erp_customers(company_id,customer_code,name,created_by) VALUES($1,$2,$3,$4) RETURNING id",
    [ctx.companyId,`E2E-STAT-${Date.now()}`,"Statement control test",ctx.userId],
  );
  const customerId = customer.rows[0].id;
  const before = await receipts.getCustomerStatement({ companyId:ctx.companyId,customerId });
  const invoice = await sales.createCustomerInvoice({ companyId:ctx.companyId,userId:ctx.userId,customerId,
    lines:[{item_id:itemId,quantity:1}] });
  const invoiceRow = await pool.query("SELECT total_amount FROM erp_customer_invoices WHERE id=$1", [invoice.invoice_id]);
  const invoiceTotal = Number(invoiceRow.rows[0].total_amount);
  const paymentAmount = Math.round(invoiceTotal / 2 * 100) / 100;
  const receipt = await receipts.createCustomerReceipt({ companyId:ctx.companyId,userId:ctx.userId,customerId,
    invoiceId:invoice.invoice_id,amount:paymentAmount,paymentMethod:"mpesa",referenceNo:`E2E-STAT-${Date.now()}` });
  const after = await receipts.getCustomerStatement({ companyId:ctx.companyId,customerId });
  const expectedOpen = invoiceTotal-paymentAmount;
  assert.equal(Math.round((after.closing_balance-before.closing_balance)*100),Math.round(expectedOpen*100));
  const ar = await pool.query(
    `SELECT COALESCE(SUM(line.debit-line.credit),0) AS balance FROM erp_journal_lines line
     JOIN erp_journals journal ON journal.id=line.journal_id AND journal.company_id=line.company_id
     WHERE line.company_id=$1 AND line.account_id=(SELECT id FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=$2)
       AND journal.id=ANY($3::uuid[]) AND journal.status='posted'`,
    [ctx.companyId,ACCOUNT_CODES.accountsReceivable,[invoice.journal_id,receipt.journal_id]],
  );
  assert.equal(Math.round(Number(ar.rows[0].balance)*100),Math.round(expectedOpen*100));
});
