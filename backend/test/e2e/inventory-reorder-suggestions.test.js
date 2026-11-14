const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getTestContext, getVendorId, getItemId, pool } = require("./helpers");
const inventory = require("../../src/services/inventoryService");
const procurement = require("../../src/services/procurementService");

test("reorder suggestion nets open PO supply and creates supplier-linked requisition", async (t) => {
  const context = await getTestContext();
  const itemId = await getItemId(context.companyId, "COKE-500");
  const vendorId = await getVendorId(context.companyId, `V-REORDER-${crypto.randomUUID().slice(0, 6)}`);
  const code = `RE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const warehouse = await pool.query(
    `INSERT INTO erp_warehouses (company_id, branch_id, code, name, is_active, is_deleted)
     VALUES ($1,$2,$3,$4,TRUE,FALSE) RETURNING id`,
    [context.companyId, context.branchId, code, `Reorder E2E ${code}`],
  );
  const priorItem = (await pool.query(
    `SELECT minimum_stock, maximum_stock, supplier_lead_time_days, preferred_vendor_id, reorder_point
     FROM erp_items WHERE id=$1 AND company_id=$2`,
    [itemId, context.companyId],
  )).rows[0];
  t.after(async () => {
    await pool.query(
      `UPDATE erp_items SET minimum_stock=$3, maximum_stock=$4, supplier_lead_time_days=$5,
         preferred_vendor_id=$6, reorder_point=$7 WHERE id=$1 AND company_id=$2`,
      [itemId, context.companyId, priorItem.minimum_stock, priorItem.maximum_stock,
        priorItem.supplier_lead_time_days, priorItem.preferred_vendor_id, priorItem.reorder_point],
    );
  });
  await pool.query(
    `UPDATE erp_items SET minimum_stock=5, maximum_stock=12, supplier_lead_time_days=3,
       reorder_point=5, preferred_vendor_id=$3 WHERE id=$1 AND company_id=$2`,
    [itemId, context.companyId, vendorId],
  );

  const openOrder = await procurement.createPurchaseOrder({
    companyId: context.companyId,
    userId: context.userId,
    vendorId,
    warehouseId: warehouse.rows[0].id,
    lines: [{ item_id: itemId, quantity: 2, unit_cost: 40 }],
  });
  await procurement.approvePurchaseOrder({ companyId: context.companyId, userId: context.userId, poId: openOrder.id });

  const suggestions = await inventory.getReorderSuggestions(context.companyId, 1000);
  const suggestion = suggestions.find((row) => row.item_id === itemId && row.warehouse_id === warehouse.rows[0].id);
  assert.ok(suggestion);
  assert.equal(Number(suggestion.available_quantity), 0);
  assert.equal(Number(suggestion.on_order_quantity), 2);
  assert.equal(Number(suggestion.target_quantity), 12);
  assert.equal(Number(suggestion.suggested_quantity), 10);

  const requisition = await procurement.createPurchaseRequisition({
    companyId: context.companyId,
    userId: context.userId,
    vendorId: suggestion.preferred_vendor_id,
    requiredDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    notes: "Generated from reorder suggestion regression",
    lines: [{ item_id: itemId, warehouse_id: warehouse.rows[0].id,
      quantity: Number(suggestion.suggested_quantity), estimated_unit_cost: Number(suggestion.estimated_unit_cost) }],
  });
  assert.equal(requisition.vendor_id, vendorId);
  const prLine = (await pool.query(
    `SELECT quantity, warehouse_id FROM erp_purchase_requisition_lines WHERE requisition_id=$1`,
    [requisition.id],
  )).rows[0];
  assert.equal(Number(prLine.quantity), 10);
  assert.equal(prLine.warehouse_id, warehouse.rows[0].id);
});
