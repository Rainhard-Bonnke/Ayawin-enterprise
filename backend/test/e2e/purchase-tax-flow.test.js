const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getVendorId, getItemId, pool } = require("./helpers");
const procurement = require("../../src/services/procurementService");
const accountsPayable = require("../../src/services/accountsPayableService");

async function getCheckerId(companyId, creatorId) {
  const result = await pool.query(
    `SELECT id FROM erp_users
     WHERE company_id = $1 AND id <> $2 AND status = 'active' AND is_deleted = FALSE
     ORDER BY created_at LIMIT 1`,
    [companyId, creatorId],
  );
  if (!result.rowCount) throw new Error("Purchase tax E2E requires a second active user for maker-checker posting");
  return result.rows[0].id;
}

async function getAccountId(companyId, predicate) {
  const result = await pool.query(
    `SELECT id FROM erp_chart_of_accounts
     WHERE company_id = $1 AND ${predicate}
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE
     ORDER BY account_code LIMIT 1`,
    [companyId],
  );
  if (!result.rowCount) throw new Error(`Required account not found: ${predicate}`);
  return result.rows[0].id;
}

async function journalLines(journalId) {
  const result = await pool.query(
    `SELECT a.account_code, l.debit, l.credit
     FROM erp_journal_lines l
     JOIN erp_chart_of_accounts a ON a.id = l.account_id AND a.company_id = l.company_id
     WHERE l.journal_id = $1 ORDER BY l.line_no`,
    [journalId],
  );
  return result.rows;
}

function assertBalanced(lines) {
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.equal(Math.round(debit * 100), Math.round(credit * 100));
}

test("E2E purchase VAT: unmatched split, verified reclassification, and receipt-matched group default", async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const checkerId = await getCheckerId(ctx.companyId, ctx.userId);
  const expenseAccountId = await getAccountId(ctx.companyId, "account_type = 'expense'");
  const inventoryAccountId = await getAccountId(ctx.companyId, "account_code = '1300'");
  const unmatchedBill = await accountsPayable.createBill({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    supplierInvoiceNo: `VAT-UNMATCHED-${Date.now()}`,
    billDate: new Date().toISOString().slice(0, 10),
    lines: [{
      description: "Tax model E2E expense",
      quantity: 1,
      unit_price: 100,
      tax_rate: 16,
      tax_treatment: "standard",
      claimable_vat_ratio: 0.625,
      account_id: expenseAccountId,
    }],
    permissions: ["tax.edit"],
  });
  const unmatchedPost = await accountsPayable.postBill({
    companyId: ctx.companyId,
    userId: checkerId,
    billId: unmatchedBill.id,
  });
  const unmatchedJournal = await journalLines(unmatchedPost.journal_id);
  assertBalanced(unmatchedJournal);
  assert.equal(Number(unmatchedJournal.find((line) => line.account_code === "1401").debit), 10);
  assert.equal(Number(unmatchedJournal.find((line) => line.account_code === "1400")?.debit || 0), 0);
  assert.equal(Number(unmatchedJournal.find((line) => line.account_code === "2100").credit), 116);

  const verified = await accountsPayable.verifySupplierBillEvidence({
    companyId: ctx.companyId,
    userId: checkerId,
    billId: unmatchedBill.id,
    etimsInvoiceNo: `ETIMS-${Date.now()}`,
    etimsReceiptSignature: `SIG-${Date.now()}`,
    verificationNote: "Matched against the supplier's original eTIMS receipt",
  });
  assert.ok(verified.reclassification_journal_id);
  const reclassJournal = await journalLines(verified.reclassification_journal_id);
  assertBalanced(reclassJournal);
  assert.equal(Number(reclassJournal.find((line) => line.account_code === "1400").debit), 10);
  assert.equal(Number(reclassJournal.find((line) => line.account_code === "1401").credit), 10);

  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const purchaseOrder = await procurement.createPurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 2, unit_cost: 40 }],
  });
  await procurement.approvePurchaseOrder({ companyId: ctx.companyId, userId: checkerId, poId: purchaseOrder.id });
  const poLine = await pool.query(
    `SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id = $1 LIMIT 1`,
    [purchaseOrder.id],
  );
  const receipt = await procurement.createAndPostGrn({
    companyId: ctx.companyId,
    userId: ctx.userId,
    purchaseOrderId: purchaseOrder.id,
    warehouseId: ctx.warehouseId,
    lines: [{ po_line_id: poLine.rows[0].id, item_id: itemId, quantity: 2, unit_cost: 40 }],
  });
  const receiptLine = await pool.query(
    `SELECT id FROM erp_goods_receipt_lines WHERE goods_receipt_id = $1 LIMIT 1`,
    [receipt.grn_id],
  );
  const matchedBill = await accountsPayable.createBill({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    supplierInvoiceNo: `VAT-MATCHED-${Date.now()}`,
    billDate: new Date().toISOString().slice(0, 10),
    purchaseOrderId: purchaseOrder.id,
    goodsReceiptId: receipt.grn_id,
    lines: [{
      description: "Tax model E2E receipt",
      quantity: 2,
      unit_price: 40,
      tax_rate: 0,
      account_id: inventoryAccountId,
      goods_receipt_line_id: receiptLine.rows[0].id,
    }],
  });
  const matchedLine = await pool.query(
    `SELECT tax_rate, tax_treatment, claimable_vat, input_vat_status
     FROM erp_supplier_bill_lines WHERE bill_id = $1`,
    [matchedBill.id],
  );
  assert.equal(Number(matchedLine.rows[0].tax_rate), 16);
  assert.equal(matchedLine.rows[0].tax_treatment, "standard");
  assert.equal(Number(matchedLine.rows[0].claimable_vat), 12.8);
  assert.equal(matchedLine.rows[0].input_vat_status, "held_no_evidence");
  const matchedPost = await accountsPayable.postBill({
    companyId: ctx.companyId,
    userId: checkerId,
    billId: matchedBill.id,
  });
  const matchedJournal = await journalLines(matchedPost.journal_id);
  assertBalanced(matchedJournal);
  assert.equal(Number(matchedJournal.find((line) => line.account_code === "1401").debit), 12.8);
});
