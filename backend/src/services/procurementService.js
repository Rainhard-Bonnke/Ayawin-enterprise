const pool = require("../db");
const { recordReceipt } = require("./inventoryService");
const gl = require("./glPostingService");

async function nextDocNo(client, companyId, table, column, prefix) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`,
    [companyId],
  );
  return `${prefix}-${new Date().getFullYear()}-${String(Number(result.rows[0].n) + 1).padStart(4, "0")}`;
}

async function createPurchaseOrder({
  companyId,
  userId,
  vendorId,
  warehouseId,
  requisitionId,
  lines,
  expectedDate,
  notes,
}) {
  if (!lines?.length) throw new Error("PO lines required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vendor = await client.query(
      `SELECT id FROM erp_vendors WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
      [vendorId, companyId],
    );
    if (!vendor.rowCount) throw new Error("Supplier is unavailable in this company");
    if (warehouseId) {
      const warehouse = await client.query(
        `SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
        [warehouseId, companyId],
      );
      if (!warehouse.rowCount) throw new Error("Warehouse is unavailable in this company");
    }
    const seenItems = new Set();
    const poNumber = await nextDocNo(client, companyId, "erp_purchase_orders", "po_number", "PO");
    let subtotal = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitCost = Number(line.unit_cost);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error("Each PO line needs a positive quantity and a non-negative unit cost");
      }
      if (!line.item_id || seenItems.has(line.item_id)) throw new Error("PO lines must use a valid item once each");
      seenItems.add(line.item_id);
      const item = await client.query(
        `SELECT id FROM erp_items WHERE id = $1 AND company_id = $2 AND is_active = TRUE
           AND is_deleted = FALSE AND is_purchasable = TRUE`,
        [line.item_id, companyId],
      );
      if (!item.rowCount) throw new Error("A PO item is unavailable or not purchasable in this company");
      subtotal += quantity * unitCost;
    }

    const poResult = await client.query(
      `INSERT INTO erp_purchase_orders (
         company_id, vendor_id, warehouse_id, requisition_id, po_number, expected_date,
         status, subtotal, total_amount, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$7,$8,$9) RETURNING *`,
      [
        companyId,
        vendorId,
        warehouseId,
        requisitionId,
        poNumber,
        expectedDate,
        subtotal,
        notes,
        userId,
      ],
    );
    const po = poResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      const lt = Number(line.quantity) * Number(line.unit_cost);
      await client.query(
        `INSERT INTO erp_purchase_order_lines (
           company_id, purchase_order_id, line_no, item_id, quantity, unit_cost, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, po.id, lineNo++, line.item_id, line.quantity, line.unit_cost, lt, userId],
      );
    }

    await client.query("COMMIT");
    return po;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function approvePurchaseOrder({ companyId, userId, poId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE erp_purchase_orders po SET status = 'approved', updated_at = NOW(), updated_by = $3
       WHERE po.id = $1 AND po.company_id = $2 AND po.status IN ('draft','submitted')
         AND EXISTS (SELECT 1 FROM erp_purchase_order_lines l WHERE l.purchase_order_id = po.id AND l.is_deleted = FALSE)
       RETURNING po.*`,
      [poId, companyId, userId],
    );
    if (!result.rowCount) throw new Error("PO not found, empty, or cannot be approved");
    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function postGoodsReceipt({ companyId, userId, grnId, postGl = true }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const grnResult = await client.query(
      `SELECT g.*, po.vendor_id FROM erp_goods_receipts g
       JOIN erp_purchase_orders po ON po.id = g.purchase_order_id
       WHERE g.id = $1 AND g.company_id = $2 AND g.status = 'draft' FOR UPDATE`,
      [grnId, companyId],
    );
    const grn = grnResult.rows[0];
    if (!grn) throw new Error("GRN not found or already posted");

    const poResult = await client.query(
      `SELECT id, warehouse_id, status FROM erp_purchase_orders
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [grn.purchase_order_id, companyId],
    );
    const po = poResult.rows[0];
    if (!po || !["approved", "sent", "partial"].includes(po.status)) {
      throw new Error("Only an approved purchase order can receive goods");
    }
    if (po.warehouse_id && po.warehouse_id !== grn.warehouse_id) {
      throw new Error("Goods must be received into the warehouse on the purchase order");
    }

    const lines = await client.query(
      `SELECT * FROM erp_goods_receipt_lines WHERE goods_receipt_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [grnId, companyId],
    );
    if (!lines.rowCount) throw new Error("GRN has no lines");

    let totalValue = 0;
    for (const line of lines.rows) {
      if (!line.po_line_id) throw new Error("Each goods receipt line must reference its purchase order line");
      const poLineResult = await client.query(
        `SELECT l.id, l.item_id, l.quantity, l.qty_received, l.unit_cost
         FROM erp_purchase_order_lines l
         WHERE l.id = $1 AND l.purchase_order_id = $2 AND l.company_id = $3 AND l.is_deleted = FALSE
         FOR UPDATE`,
        [line.po_line_id, grn.purchase_order_id, companyId],
      );
      const poLine = poLineResult.rows[0];
      const receiptQty = Number(line.quantity);
      const receiptCost = Number(line.unit_cost);
      if (!poLine || poLine.item_id !== line.item_id) throw new Error("Receipt item must match its purchase order line");
      if (Math.abs(receiptCost - Number(poLine.unit_cost)) > 0.00005) {
        throw new Error("Receipt unit cost must match the approved purchase order; record price differences for review");
      }
      if (!Number.isFinite(receiptQty) || receiptQty <= 0 || !Number.isFinite(receiptCost) || receiptCost < 0) {
        throw new Error("Receipt lines need a positive quantity and a non-negative unit cost");
      }
      if (receiptQty + Number(poLine.qty_received) > Number(poLine.quantity) + 0.00005) {
        throw new Error("Receipt quantity exceeds the outstanding purchase order quantity");
      }
      const receiptLayer = await recordReceipt(client, {
        companyId,
        warehouseId: grn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost: line.unit_cost,
        referenceType: "goods_receipt",
        referenceId: grnId,
        batchNo: line.batch_no,
        expiryDate: line.expiry_date,
        userId,
        movementDate: grn.received_date,
        sourceType: "supplier_receipt",
        receiptLineId: line.id,
      });
      const lotLink = await client.query(
        `INSERT INTO erp_goods_receipt_lot_links (company_id, goods_receipt_line_id, lot_id, quantity_received, created_by, layer_id)
         SELECT gl.company_id, gl.id, lot.id, gl.quantity, $3, $5
         FROM erp_goods_receipt_lines gl
         JOIN erp_goods_receipts gr ON gr.id = gl.goods_receipt_id AND gr.company_id = gl.company_id
         JOIN erp_items i ON i.id = gl.item_id AND i.company_id = gl.company_id AND i.lot_tracking_enabled = TRUE
         JOIN erp_inventory_lots lot ON lot.company_id = gl.company_id AND lot.warehouse_id = gr.warehouse_id
           AND lot.item_id = gl.item_id AND lot.batch_no = BTRIM(gl.batch_no) AND lot.expiry_date = gl.expiry_date
         WHERE gl.id = $1 AND gl.company_id = $2 AND gl.goods_receipt_id = $4
         ON CONFLICT (goods_receipt_line_id) DO NOTHING
         RETURNING id`,
        [line.id, companyId, userId, grnId, receiptLayer?.layerId || null],
      );
      const trackedItem = await client.query(
        "SELECT lot_tracking_enabled FROM erp_items WHERE id = $1 AND company_id = $2",
        [line.item_id, companyId],
      );
      if (trackedItem.rows[0]?.lot_tracking_enabled && !lotLink.rowCount) {
        throw new Error("Unable to link the tracked goods receipt line to its inventory lot");
      }
      totalValue += Number(line.quantity) * Number(line.unit_cost);

      if (line.po_line_id) {
        await client.query(
          `UPDATE erp_purchase_order_lines
           SET qty_received = qty_received + $2, updated_at = NOW()
           WHERE id = $1`,
          [line.po_line_id, line.quantity],
        );
      }
    }

    await client.query(
      `UPDATE erp_purchase_orders po SET status = CASE
         WHEN (SELECT COALESCE(SUM(qty_received),0) FROM erp_purchase_order_lines WHERE purchase_order_id = po.id)
              >= (SELECT COALESCE(SUM(quantity),0) FROM erp_purchase_order_lines WHERE purchase_order_id = po.id)
         THEN 'received' ELSE 'partial' END
       WHERE id = $1`,
      [grn.purchase_order_id],
    );

    let journalId = null;
    if (postGl && totalValue > 0) {
      const accounts = await client.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code IN ('1300','2150') AND is_active = TRUE
           AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId],
      );
      const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
      if (!byCode["1300"] || !byCode["2150"]) {
        throw new Error("Inventory or goods-received-not-invoiced account 2150 is missing; receipt was not posted");
      }
      if (byCode["1300"] && byCode["2150"]) {
        const journal = await gl.createJournalInTransaction(client, {
          companyId,
          userId,
          entryDate: grn.received_date,
          journalType: "purchase",
          referenceNo: grn.grn_number,
          description: `GRN stock receipt ${grn.grn_number}`,
          lines: [
            { account_id: byCode["1300"], debit: totalValue, credit: 0, description: "Inventory" },
            { account_id: byCode["2150"], debit: 0, credit: totalValue, description: "Goods received not invoiced" },
          ],
        });
        await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
        journalId = journal.id;
      }
    }

    await client.query(
      `UPDATE erp_goods_receipts SET status = 'posted', posted_at = NOW(), posted_by = $3,
         journal_id = $4, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [grnId, companyId, userId, journalId],
    );
    await client.query("COMMIT");

    return { ok: true, grn_id: grnId, journal_id: journalId, total_value: totalValue };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function createAndPostGrn({
  companyId,
  userId,
  purchaseOrderId,
  warehouseId,
  lines,
  receivedDate,
  notes,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!Array.isArray(lines) || !lines.length) throw new Error("Goods receipt lines required");
    const poResult = await client.query(
      `SELECT id, warehouse_id, status FROM erp_purchase_orders
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [purchaseOrderId, companyId],
    );
    const po = poResult.rows[0];
    if (!po || !["approved", "sent", "partial"].includes(po.status)) {
      throw new Error("Only an approved purchase order can receive goods");
    }
    if (po.warehouse_id && po.warehouse_id !== warehouseId) {
      throw new Error("Goods must be received into the warehouse on the purchase order");
    }
    const warehouse = await client.query(
      `SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
      [warehouseId, companyId],
    );
    if (!warehouse.rowCount) throw new Error("Warehouse is unavailable in this company");
    const seenPoLines = new Set();
    for (const line of lines) {
      if (!line.po_line_id) throw new Error("Each goods receipt line must reference its purchase order line");
      if (seenPoLines.has(line.po_line_id)) throw new Error("A purchase order line can appear only once on a goods receipt");
      seenPoLines.add(line.po_line_id);
      const poLineResult = await client.query(
        `SELECT l.id, l.item_id, l.quantity, l.qty_received, l.unit_cost
         FROM erp_purchase_order_lines l
         WHERE l.id = $1 AND l.purchase_order_id = $2 AND l.company_id = $3 AND l.is_deleted = FALSE
         FOR UPDATE`,
        [line.po_line_id, purchaseOrderId, companyId],
      );
      const poLine = poLineResult.rows[0];
      const quantity = Number(line.quantity);
      const unitCost = Number(line.unit_cost);
      if (!poLine || poLine.item_id !== line.item_id) throw new Error("Receipt item must match its purchase order line");
      if (Math.abs(unitCost - Number(poLine.unit_cost)) > 0.00005) {
        throw new Error("Receipt unit cost must match the approved purchase order; record price differences for review");
      }
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error("Receipt lines need a positive quantity and a non-negative unit cost");
      }
      const alreadyInDrafts = await client.query(
        `SELECT COALESCE(SUM(gl.quantity), 0) AS quantity
         FROM erp_goods_receipt_lines gl JOIN erp_goods_receipts gr ON gr.id = gl.goods_receipt_id
         WHERE gl.po_line_id = $1 AND gl.company_id = $2 AND gl.is_deleted = FALSE AND gr.status = 'draft'`,
        [line.po_line_id, companyId],
      );
      if (quantity + Number(poLine.qty_received) + Number(alreadyInDrafts.rows[0].quantity) > Number(poLine.quantity) + 0.00005) {
        throw new Error("Receipt quantity exceeds the outstanding purchase order quantity");
      }
    }
    const grnNumber = await nextDocNo(client, companyId, "erp_goods_receipts", "grn_number", "GRN");
    const grnResult = await client.query(
      `INSERT INTO erp_goods_receipts (
         company_id, purchase_order_id, warehouse_id, grn_number, received_date, status, notes, created_by
       ) VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),'draft',$6,$7) RETURNING *`,
      [companyId, purchaseOrderId, warehouseId, grnNumber, receivedDate, notes, userId],
    );
    const grn = grnResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO erp_goods_receipt_lines (
           company_id, goods_receipt_id, po_line_id, line_no, item_id, quantity, unit_cost, batch_no, expiry_date, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          companyId,
          grn.id,
          line.po_line_id,
          lineNo++,
          line.item_id,
          line.quantity,
          line.unit_cost,
          line.batch_no,
          line.expiry_date,
          userId,
        ],
      );
    }
    await client.query("COMMIT");

    return postGoodsReceipt({ companyId, userId, grnId: grn.id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createPurchaseOrder,
  approvePurchaseOrder,
  postGoodsReceipt,
  createAndPostGrn,
};
