const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const procurement = require("../../src/services/procurementService");

test("RFQ workflow awards a supplier and converts to a purchase order", async () => {
  const context = await getTestContext();
  const item = await pool.query(
    `INSERT INTO erp_items (company_id, item_code, name, is_active, is_purchasable, created_by)
     VALUES ($1, $2, $3, TRUE, TRUE, $4)
     RETURNING id`,
    [context.companyId, `RFQ-${Date.now()}`, "RFQ Item", context.userId],
  );
  const requisition = await procurement.createPurchaseRequisition({
    companyId: context.companyId,
    userId: context.userId,
    branchId: null,
    lines: [{ item_id: item.rows[0].id, quantity: 10, estimated_unit_cost: 100 }],
  });
  await procurement.approvePurchaseRequisition({
    companyId: context.companyId,
    userId: context.reviewerId,
    requisitionId: requisition.id,
  });

  const rfq = await procurement.createRfqFromRequisition({
    companyId: context.companyId,
    userId: context.userId,
    requisitionId: requisition.id,
    vendorIds: [],
  });
  const vendorOne = await pool.query(
    `INSERT INTO erp_vendors (company_id, vendor_code, name, tax_id, is_active, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id`,
    [context.companyId, `V1${Date.now()}`, `RFQ Vendor 1 ${Date.now()}`, `A${String(Date.now()).slice(-9)}Z`, context.userId],
  );
  const vendorTwo = await pool.query(
    `INSERT INTO erp_vendors (company_id, vendor_code, name, tax_id, is_active, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id`,
    [context.companyId, `V2${Date.now()}`, `RFQ Vendor 2 ${Date.now()}`, `P${String(Date.now()+1).slice(-9)}X`, context.userId],
  );
  const vendorThree = await pool.query(
    `INSERT INTO erp_vendors (company_id, vendor_code, name, tax_id, is_active, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id`,
    [context.companyId, `V3${Date.now()}`, `RFQ Vendor 3 ${Date.now()}`, `A${String(Date.now()+2).slice(-9)}Y`, context.userId],
  );

  await procurement.addSupplierToRfq({ companyId: context.companyId, userId: context.userId, rfqId: rfq.id, vendorId: vendorOne.rows[0].id });
  await procurement.addSupplierToRfq({ companyId: context.companyId, userId: context.userId, rfqId: rfq.id, vendorId: vendorTwo.rows[0].id });
  await procurement.addSupplierToRfq({ companyId: context.companyId, userId: context.userId, rfqId: rfq.id, vendorId: vendorThree.rows[0].id });

  const quoteOne = await procurement.submitRfqQuote({
    companyId: context.companyId,
    userId: context.userId,
    rfqId: rfq.id,
    vendorId: vendorOne.rows[0].id,
    quoteNumber: "Q-1",
    lines: [{ requisition_line_id: null, item_id: item.rows[0].id, quantity: 10, unit_price: 95 }],
  });
  const quoteTwo = await procurement.submitRfqQuote({
    companyId: context.companyId,
    userId: context.userId,
    rfqId: rfq.id,
    vendorId: vendorTwo.rows[0].id,
    quoteNumber: "Q-2",
    lines: [{ requisition_line_id: null, item_id: item.rows[0].id, quantity: 10, unit_price: 92 }],
  });
  const quoteThree = await procurement.submitRfqQuote({
    companyId: context.companyId,
    userId: context.userId,
    rfqId: rfq.id,
    vendorId: vendorThree.rows[0].id,
    quoteNumber: "Q-3",
    lines: [{ requisition_line_id: null, item_id: item.rows[0].id, quantity: 10, unit_price: 90 }],
  });

  const awarded = await procurement.awardRfq({
    companyId: context.companyId,
    userId: context.reviewerId,
    rfqId: rfq.id,
    quoteId: quoteThree.id,
    justification: "Lowest compliant quote",
  });
  assert.equal(awarded.status, "awarded");

  const po = await procurement.createPurchaseOrderFromRfq({
    companyId: context.companyId,
    userId: context.userId,
    rfqId: rfq.id,
    quoteId: quoteThree.id,
    expectedDate: "2027-01-10",
    notes: "Awarded after RFQ comparison",
  });
  assert.ok(po.id);
  assert.equal(po.vendor_id, vendorThree.rows[0].id);
});

test("PO amendment and purchase return flow preserve versioning and return credits", async () => {
  const context = await getTestContext();
  const item = await pool.query(
    `INSERT INTO erp_items (company_id, item_code, name, is_active, is_purchasable, created_by)
     VALUES ($1, $2, $3, TRUE, TRUE, $4)
     RETURNING id`,
    [context.companyId, `POM-${Date.now()}`, "PO Return Item", context.userId],
  );
  const vendor = await pool.query(
    `INSERT INTO erp_vendors (company_id, vendor_code, name, tax_id, is_active, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id`,
    [context.companyId, `PO-${Date.now()}`, `POM Vendor ${Date.now()}`, `P${String(Date.now()+3).slice(-9)}Z`, context.userId],
  );
  const po = await procurement.createPurchaseOrder({
    companyId: context.companyId,
    userId: context.userId,
    vendorId: vendor.rows[0].id,
    warehouseId: null,
    lines: [{ item_id: item.rows[0].id, quantity: 2, unit_cost: 100 }],
    expectedDate: "2026-01-05",
    notes: "Test PO",
  });
  const approvedPo = await procurement.approvePurchaseOrder({
    companyId: context.companyId,
    userId: context.reviewerId,
    poId: po.id,
  });
  assert.equal(approvedPo.status, "approved");

  const amended = await procurement.amendPurchaseOrder({
    companyId: context.companyId,
    userId: context.reviewerId,
    poId: po.id,
    reason: "Quantity adjustment",
    lines: [{ item_id: item.rows[0].id, quantity: 3, unit_cost: 100 }],
  });
  assert.ok(amended.version_no >= 2);

  const grn = await procurement.createAndPostGrn({
    companyId: context.companyId,
    userId: context.userId,
    purchaseOrderId: po.id,
    warehouseId: context.warehouseId,
    lines: [{ po_line_id: (await pool.query("SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id = $1 LIMIT 1", [po.id])).rows[0].id, item_id: item.rows[0].id, quantity: 2, unit_cost: 100 }],
    receivedDate: "2026-01-03",
  });
  assert.ok(grn.grn_id);

  const returned = await procurement.createPurchaseReturn({
    companyId: context.companyId,
    userId: context.userId,
    receiptId: grn.grn_id,
    reason: "Damaged on receipt",
    lines: [{ goods_receipt_line_id: (await pool.query("SELECT id FROM erp_goods_receipt_lines WHERE goods_receipt_id = $1 LIMIT 1", [grn.grn_id])).rows[0].id, item_id: item.rows[0].id, quantity: 1, unit_price: 100 }],
  });
  assert.equal(returned.status, "requested");
  assert.ok(Number(returned.total_amount) > 0);
});
