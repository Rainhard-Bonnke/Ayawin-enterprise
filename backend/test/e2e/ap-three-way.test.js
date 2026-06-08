const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getVendorId, getItemId, pool } = require('./helpers');
const procurement = require('../../src/services/procurementService');
const ap = require('../../src/services/apService');

test('E2E AP: GRN -> vendor bill 3-way match -> post updates supplier balance', async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const po = await procurement.createPurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 20, unit_cost: 55 }],
  });

  await procurement.approvePurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    poId: po.id,
    actor: { role_name: 'Administrator', permissions: ['procurement.approve', 'procurement.md_approve'] },
  });

  const grn = await procurement.createAndPostGrn({
    companyId: ctx.companyId,
    userId: ctx.userId,
    purchaseOrderId: po.id,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 10, unit_cost: 55 }],
    landedCostTotal: 500,
  });
  assert.equal(grn.ok, true);

  const bill = await ap.createVendorBillFromGrn({
    companyId: ctx.companyId,
    userId: ctx.userId,
    goodsReceiptId: grn.grn_id,
  });
  assert.equal(bill.match_status, 'matched');

  await assert.rejects(
    () => ap.recordVendorPayment({
      companyId: ctx.companyId,
      userId: ctx.userId,
      invoiceId: bill.id,
      amount: 100,
    }),
    /Post the vendor bill before payment/,
  );

  const before = await pool.query('SELECT ap_balance FROM erp_vendors WHERE id = $1', [vendorId]);
  const beforeBal = Number(before.rows[0]?.ap_balance || 0);

  await ap.postVendorBill({ companyId: ctx.companyId, userId: ctx.userId, billId: bill.id });

  const after = await pool.query('SELECT ap_balance FROM erp_vendors WHERE id = $1', [vendorId]);
  assert.ok(Number(after.rows[0].ap_balance) > beforeBal);
});
