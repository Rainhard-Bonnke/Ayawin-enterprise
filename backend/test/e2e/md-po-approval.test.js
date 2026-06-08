const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getVendorId, getItemId } = require('./helpers');
const procurement = require('../../src/services/procurementService');

test('E2E high-value PO requires MD approval path', async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  const po = await procurement.createPurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 3000, unit_cost: 50 }],
  });
  assert.ok(po.requires_md_approval);

  const opsManager = { role_name: 'Operations Manager', permissions: ['procurement.approve'] };
  const pending = await procurement.approvePurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    poId: po.id,
    actor: opsManager,
  });
  assert.equal(pending.status, 'pending_md_approval');

  const md = { role_name: 'Managing Director', permissions: ['procurement.md_approve'] };
  const approved = await procurement.approvePurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    poId: po.id,
    actor: md,
  });
  assert.equal(approved.status, 'approved');
});
