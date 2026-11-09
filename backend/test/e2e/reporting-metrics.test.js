const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getVendorId, getCustomerId, getItemId, pool } = require("./helpers");
const reporting = require("../../src/services/reportingService");

test("E2E reporting metrics: AP uses bill balances and OTIF checks due date and quantity", async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const suffix = Date.now();
  const billIds = [];
  const poIds = [];
  const orderIds = [];
  const deliveryIds = [];

  try {
    const apBefore = await reporting.METRICS.ap_outstanding(ctx.companyId);
    const bill = await pool.query(
      `INSERT INTO erp_supplier_bills (
         company_id, vendor_id, bill_no, supplier_invoice_no, bill_date, due_date,
         total_amount, amount_paid, status
       ) VALUES ($1,$2,$3,$4,CURRENT_DATE,CURRENT_DATE,100,40,'partial') RETURNING id`,
      [ctx.companyId, vendorId, `E2E-BILL-${suffix}`, `E2E-SUPPLIER-${suffix}`],
    );
    billIds.push(bill.rows[0].id);
    const po = await pool.query(
      `INSERT INTO erp_purchase_orders (
         company_id, vendor_id, warehouse_id, po_number, order_date, status, total_amount
       ) VALUES ($1,$2,$3,$4,CURRENT_DATE,'approved',900) RETURNING id`,
      [ctx.companyId, vendorId, ctx.warehouseId, `E2E-PO-${suffix}`],
    );
    poIds.push(po.rows[0].id);
    const apAfter = await reporting.METRICS.ap_outstanding(ctx.companyId);
    assert.equal(apAfter - apBefore, 60);

    const today = await pool.query("SELECT CURRENT_DATE::text AS today");
    const dueDate = today.rows[0].today;
    const lateDate = await pool.query("SELECT (CURRENT_DATE - 1)::text AS late_date");
    const lateRequiredDate = lateDate.rows[0].late_date;
    const coverageBefore = await reporting.METRICS.otif_coverage(ctx.companyId);
    const baselineCoverage = await pool.query(
      `SELECT COUNT(*)::int AS eligible,
              COUNT(*) FILTER (WHERE required_date IS NOT NULL)::int AS dated
       FROM erp_sales_orders
       WHERE company_id = $1 AND is_deleted = FALSE
         AND status NOT IN ('draft','cancelled') AND order_date <= CURRENT_DATE`,
      [ctx.companyId],
    );
    const baseline = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (
                WHERE line_totals.ordered_quantity > 0
                  AND line_totals.delivered_quantity >= line_totals.ordered_quantity
                  AND delivery_dates.last_delivery_date <= so.required_date
              )::int AS on_time_in_full
       FROM erp_sales_orders so
       JOIN LATERAL (
         SELECT COALESCE(SUM(sol.quantity), 0) AS ordered_quantity,
                COALESCE(SUM(sol.qty_delivered), 0) AS delivered_quantity
         FROM erp_sales_order_lines sol
         WHERE sol.sales_order_id = so.id AND sol.company_id = so.company_id AND sol.is_deleted = FALSE
       ) line_totals ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(dn.delivery_date) AS last_delivery_date
         FROM erp_delivery_notes dn
         WHERE dn.sales_order_id = so.id AND dn.company_id = so.company_id
           AND dn.status = 'posted' AND dn.is_deleted = FALSE
       ) delivery_dates ON TRUE
       WHERE so.company_id = $1 AND so.is_deleted = FALSE
         AND so.status NOT IN ('draft','cancelled') AND so.required_date <= CURRENT_DATE`,
      [ctx.companyId],
    );

    for (const [label, requiredDate, deliveryDate, deliveredQuantity] of [
      ["ontime", dueDate, dueDate, 5],
      ["latepartial", lateRequiredDate, dueDate, 3],
    ]) {
      const order = await pool.query(
        `INSERT INTO erp_sales_orders (
           company_id, customer_id, warehouse_id, order_no, order_date, required_date,
           status, subtotal, tax_amount, total_amount
         ) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,'partial',350,0,350) RETURNING id`,
        [ctx.companyId, customerId, ctx.warehouseId, `E2E-OTIF-${label}-${suffix}`, requiredDate],
      );
      orderIds.push(order.rows[0].id);
      const line = await pool.query(
        `INSERT INTO erp_sales_order_lines (
           company_id, sales_order_id, line_no, item_id, quantity, qty_delivered, unit_price, line_total
         ) VALUES ($1,$2,1,$3,5,$4,70,350) RETURNING id`,
        [ctx.companyId, order.rows[0].id, itemId, deliveredQuantity],
      );
      const delivery = await pool.query(
        `INSERT INTO erp_delivery_notes (
           company_id, sales_order_id, warehouse_id, delivery_no, delivery_date, status
         ) VALUES ($1,$2,$3,$4,$5,'posted') RETURNING id`,
        [ctx.companyId, order.rows[0].id, ctx.warehouseId, `E2E-DN-${label}-${suffix}`, deliveryDate],
      );
      deliveryIds.push(delivery.rows[0].id);
      await pool.query(
        `INSERT INTO erp_delivery_note_lines (
           company_id, delivery_note_id, so_line_id, line_no, item_id, quantity
         ) VALUES ($1,$2,$3,1,$4,$5)`,
        [ctx.companyId, delivery.rows[0].id, line.rows[0].id, itemId, deliveredQuantity],
      );
    }

    const otifAfter = await reporting.METRICS.otif(ctx.companyId);
    const coverageAfter = await reporting.METRICS.otif_coverage(ctx.companyId);
    const expected = Math.round(
      ((Number(baseline.rows[0].on_time_in_full) + 1) / (Number(baseline.rows[0].total) + 2)) * 100,
    );
    const expectedCoverage = Math.round(
      ((Number(baselineCoverage.rows[0].dated) + 2) / (Number(baselineCoverage.rows[0].eligible) + 2)) * 100,
    );
    assert.equal(otifAfter, expected);
    assert.equal(coverageAfter, expectedCoverage);
    assert.ok(coverageAfter >= coverageBefore);
  } finally {
    if (deliveryIds.length) {
      await pool.query("DELETE FROM erp_delivery_notes WHERE id = ANY($1::uuid[])", [deliveryIds]);
    }
    if (orderIds.length) {
      await pool.query("DELETE FROM erp_sales_orders WHERE id = ANY($1::uuid[])", [orderIds]);
    }
    if (billIds.length) {
      await pool.query("DELETE FROM erp_supplier_bills WHERE id = ANY($1::uuid[])", [billIds]);
    }
    if (poIds.length) {
      await pool.query("DELETE FROM erp_purchase_orders WHERE id = ANY($1::uuid[])", [poIds]);
    }
  }
});