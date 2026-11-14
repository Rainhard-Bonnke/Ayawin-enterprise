const pool = require("../db");
const { recordReceipt } = require("./inventoryService");
const gl = require("./glPostingService");
const etimsEvents = require("./etimsEventService");
const { roundMoney } = require("../lib/money");

async function nextDocNo(client, companyId, table, column, prefix) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`,
    [companyId],
  );
  return `${prefix}-${new Date().getFullYear()}-${String(Number(result.rows[0].n) + 1).padStart(4, "0")}`;
}

async function createPurchaseRequisition({ companyId, userId, branchId, vendorId = null, requiredDate, notes, lines }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Requisition lines required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (vendorId) {
      const vendor = await client.query(
        `SELECT id FROM erp_vendors WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE`,
        [vendorId, companyId],
      );
      if (!vendor.rowCount) throw new Error("Preferred supplier is unavailable in this company");
    }
    const seenItems = new Set();
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!line.item_id || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Each requisition line needs a valid item and a positive quantity");
      }
      if (seenItems.has(line.item_id)) throw new Error("Each item can appear once per requisition");
      seenItems.add(line.item_id);
      const item = await client.query(
        `SELECT id FROM erp_items WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
        [line.item_id, companyId],
      );
      if (!item.rowCount) throw new Error("A requisition item is unavailable in this company");
      if (line.warehouse_id) {
        const warehouse = await client.query(
          `SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
          [line.warehouse_id, companyId],
        );
        if (!warehouse.rowCount) throw new Error("A requisition warehouse is unavailable in this company");
      }
    }
    const requisitionNo = await nextDocNo(client, companyId, "erp_purchase_requisitions", "requisition_no", "PR");
    const header = await client.query(
      `INSERT INTO erp_purchase_requisitions (
         company_id, branch_id, requester_id, requisition_no, required_date, status, notes, created_by
       ) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)
       RETURNING *`,
      [companyId, branchId || null, userId, requisitionNo, requiredDate || null, notes || null, userId],
    );
    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO erp_purchase_requisition_lines (
           company_id, requisition_id, line_no, item_id, quantity, uom_id, estimated_unit_cost, warehouse_id, created_by
         ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8)`,
        [companyId, header.rows[0].id, lineNo++, line.item_id, Number(line.quantity), Number(line.estimated_unit_cost || 0), line.warehouse_id || null, userId],
      );
    }
    await client.query("COMMIT");
    return header.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function approvePurchaseRequisition({ companyId, userId, requisitionId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requisition = await client.query(
      `UPDATE erp_purchase_requisitions
       SET status = 'approved', updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2 AND status IN ('draft','submitted')
         AND EXISTS (SELECT 1 FROM erp_purchase_requisition_lines WHERE requisition_id = $1 AND is_deleted = FALSE)
       RETURNING *`,
      [requisitionId, companyId, userId],
    );
    if (!requisition.rowCount) throw new Error("Requisition not found, empty, or cannot be approved");
    await client.query("COMMIT");
    return requisition.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

async function createRfqFromRequisition({ companyId, userId, requisitionId, vendorIds = [], dueDate = null, notes = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requisition = await client.query(
      `SELECT id, requisition_no, status FROM erp_purchase_requisitions
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [requisitionId, companyId],
    );
    if (!requisition.rowCount) throw new Error("Requisition not found");
    if (!['approved', 'ordered'].includes(requisition.rows[0].status)) {
      throw new Error("Only an approved requisition can create an RFQ");
    }
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM erp_rfq_headers WHERE company_id = $1`,
      [companyId],
    );
    const rfqNo = `RFQ-${new Date().getFullYear()}-${String(Number(count.rows[0].n) + 1).padStart(4, '0')}`;
    const rfq = await client.query(
      `INSERT INTO erp_rfq_headers (company_id, requisition_id, rfq_no, due_date, status, notes, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6) RETURNING *`,
      [companyId, requisitionId, rfqNo, dueDate, notes, userId],
    );
    const lines = await client.query(
      `SELECT * FROM erp_purchase_requisition_lines
       WHERE requisition_id = $1 AND company_id = $2 AND is_deleted = FALSE ORDER BY line_no`,
      [requisitionId, companyId],
    );
    let lineNo = 1;
    for (const line of lines.rows) {
      await client.query(
        `INSERT INTO erp_rfq_lines (company_id, rfq_id, requisition_line_id, item_id, quantity, line_no, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [companyId, rfq.rows[0].id, line.id, line.item_id, Number(line.quantity), lineNo++, userId],
      );
    }
    for (const vendorId of Array.isArray(vendorIds) ? vendorIds : []) {
      await client.query(
        `INSERT INTO erp_rfq_participants (company_id, rfq_id, vendor_id, status)
         VALUES ($1, $2, $3, 'invited')
         ON CONFLICT (rfq_id, vendor_id) DO NOTHING`,
        [companyId, rfq.rows[0].id, vendorId],
      );
    }
    await client.query("COMMIT");
    return rfq.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function addSupplierToRfq({ companyId, userId, rfqId, vendorId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rfq = await client.query(
      `SELECT id FROM erp_rfq_headers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [rfqId, companyId],
    );
    if (!rfq.rowCount) throw new Error("RFQ not found");
    const vendor = await client.query(
      `SELECT id FROM erp_vendors WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
      [vendorId, companyId],
    );
    if (!vendor.rowCount) throw new Error("Supplier not available");
    await client.query(
      `INSERT INTO erp_rfq_participants (company_id, rfq_id, vendor_id, status)
       VALUES ($1, $2, $3, 'invited')
       ON CONFLICT (rfq_id, vendor_id) DO NOTHING`,
      [companyId, rfqId, vendorId],
    );
    await client.query("COMMIT");
    return { id: rfqId, vendor_id: vendorId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function submitRfqQuote({ companyId, userId, rfqId, vendorId, quoteNumber, lines }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("RFQ quote lines required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rfq = await client.query(
      `SELECT * FROM erp_rfq_headers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [rfqId, companyId],
    );
    if (!rfq.rowCount) throw new Error("RFQ not found");
    const participant = await client.query(
      `SELECT id FROM erp_rfq_participants WHERE rfq_id = $1 AND vendor_id = $2 AND company_id = $3`,
      [rfqId, vendorId, companyId],
    );
    if (!participant.rowCount) throw new Error("This supplier was not invited to the RFQ");
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM erp_rfq_quotes WHERE company_id = $1`,
      [companyId],
    );
    const quoteNo = quoteNumber || `Q-${new Date().getFullYear()}-${String(Number(count.rows[0].n) + 1).padStart(4, '0')}`;
    const quote = await client.query(
      `INSERT INTO erp_rfq_quotes (company_id, rfq_id, vendor_id, quote_no, status, created_by)
       VALUES ($1, $2, $3, $4, 'submitted', $5) RETURNING *`,
      [companyId, rfqId, vendorId, quoteNo, userId],
    );
    let total = 0;
    const rfqLines = await client.query(
      `SELECT * FROM erp_rfq_lines WHERE rfq_id = $1 AND company_id = $2 AND is_deleted = FALSE ORDER BY line_no`,
      [rfqId, companyId],
    );
    for (const line of rfqLines.rows) {
      const matching = lines.find((input) => input.item_id === line.item_id || input.rfq_line_id === line.id);
      if (!matching) throw new Error("Each RFQ line requires a quote");
      const quantity = Number(matching.quantity || line.quantity);
      const unitPrice = Number(matching.unit_price || 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Each RFQ quote line must contain a positive quantity and a non-negative unit price");
      }
      const lineTotal = roundMoney(quantity * unitPrice);
      total = roundMoney(total + lineTotal);
      await client.query(
        `INSERT INTO erp_rfq_quote_lines (company_id, quote_id, rfq_line_id, item_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [companyId, quote.rows[0].id, line.id, line.item_id, quantity, unitPrice, lineTotal],
      );
    }
    await client.query(
      `UPDATE erp_rfq_quotes SET total_amount = $3, submitted_at = NOW() WHERE id = $1 AND company_id = $2`,
      [quote.rows[0].id, companyId, total],
    );
    await client.query(
      `UPDATE erp_rfq_participants SET status = 'quoted' WHERE rfq_id = $1 AND vendor_id = $2 AND company_id = $3`,
      [rfqId, vendorId, companyId],
    );
    await client.query("COMMIT");
    return { ...quote.rows[0], total_amount: total };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function awardRfq({ companyId, userId, rfqId, quoteId, justification }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rfq = await client.query(
      `SELECT * FROM erp_rfq_headers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [rfqId, companyId],
    );
    if (!rfq.rowCount) throw new Error("RFQ not found");
    const quote = await client.query(
      `UPDATE erp_rfq_quotes SET status = 'awarded', awarded_by = $3, awarded_at = NOW(), justification = $4
       WHERE id = $1 AND rfq_id = $2 AND company_id = $3
       RETURNING *`,
      [quoteId, rfqId, companyId, String(justification || "Lowest total compliant quote").slice(0, 1000)],
    );
    if (!quote.rowCount) throw new Error("Winning quote not found for this RFQ");
    await client.query(
      `UPDATE erp_rfq_quotes SET status = 'rejected'
       WHERE rfq_id = $1 AND company_id = $2 AND id <> $3`,
      [rfqId, companyId, quoteId],
    );
    await client.query(
      `UPDATE erp_rfq_participants SET status = 'awarded' WHERE rfq_id = $1 AND company_id = $2 AND vendor_id = $3`,
      [rfqId, companyId, quote.rows[0].vendor_id],
    );
    await client.query(
      `UPDATE erp_rfq_headers SET status = 'awarded', updated_at = NOW(), updated_by = $3 WHERE id = $1 AND company_id = $2`,
      [rfqId, companyId, userId],
    );
    await client.query("COMMIT");
    return { ...quote.rows[0], status: "awarded" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function createPurchaseOrderFromRfq({ companyId, userId, rfqId, quoteId, expectedDate, notes }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quote = await client.query(
      `SELECT q.*, p.vendor_id FROM erp_rfq_quotes q
       JOIN erp_rfq_participants p ON p.rfq_id = q.rfq_id AND p.vendor_id = q.vendor_id
       WHERE q.id = $1 AND q.company_id = $2 AND q.status = 'awarded' AND q.rfq_id = $3`,
      [quoteId, companyId, rfqId],
    );
    if (!quote.rowCount) throw new Error("Awarded quote not found");
    const quoteLines = await client.query(
      `SELECT * FROM erp_rfq_quote_lines WHERE quote_id = $1 AND company_id = $2`,
      [quoteId, companyId],
    );
    if (!quoteLines.rowCount) throw new Error("Awarded quote has no lines");
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM erp_purchase_orders WHERE company_id = $1`,
      [companyId],
    );
    const poNumber = `PO-${new Date().getFullYear()}-${String(Number(count.rows[0].n) + 1).padStart(4, '0')}`;
    const total = quoteLines.rows.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const po = await client.query(
      `INSERT INTO erp_purchase_orders (company_id, vendor_id, po_number, expected_date, status, subtotal, total_amount, notes, created_by, version_no)
       VALUES ($1, $2, $3, $4, 'approved', $5, $5, $6, $7, 1) RETURNING *`,
      [companyId, quote.rows[0].vendor_id, poNumber, expectedDate, total, notes || null, userId],
    );
    let lineNo = 1;
    for (const row of quoteLines.rows) {
      await client.query(
        `INSERT INTO erp_purchase_order_lines (company_id, purchase_order_id, line_no, item_id, quantity, unit_cost, line_total, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [companyId, po.rows[0].id, lineNo++, row.item_id, Number(row.quantity), Number(row.unit_price), Number(row.line_total), userId],
      );
    }
    await client.query("COMMIT");
    return po.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function amendPurchaseOrder({ companyId, userId, poId, reason, lines }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Amendment lines required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const po = await client.query(
      `SELECT * FROM erp_purchase_orders WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [poId, companyId],
    );
    if (!po.rowCount) throw new Error("PO not found");
    const nextVersion = Number(po.rows[0].version_no || 1) + 1;
    const amendmentNo = `POA-${new Date().getFullYear()}-${String(nextVersion).padStart(4, '0')}`;
    const amendment = await client.query(
      `INSERT INTO erp_purchase_order_amendments (company_id, purchase_order_id, amendment_no, version_no, reason, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6) RETURNING *`,
      [companyId, poId, amendmentNo, nextVersion, reason || null, userId],
    );
    let total = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitCost = Number(line.unit_cost);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error("Each amendment line needs positive quantity and valid unit cost");
      }
      const lineTotal = roundMoney(quantity * unitCost);
      total = roundMoney(total + lineTotal);
      await client.query(
        `INSERT INTO erp_purchase_order_amendment_lines (company_id, amendment_id, item_id, quantity, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, amendment.rows[0].id, line.item_id, quantity, unitCost, lineTotal],
      );
    }
    await client.query(
      `UPDATE erp_purchase_orders
       SET version_no = $3, updated_at = NOW(), updated_by = $4, subtotal = $5, total_amount = $5
       WHERE id = $1 AND company_id = $2`,
      [poId, companyId, nextVersion, userId, total],
    );
    await client.query("COMMIT");
    return { ...po.rows[0], version_no: nextVersion, amendment_id: amendment.rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function createPurchaseReturn({ companyId, userId, receiptId, reason, lines }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Purchase return lines required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const receipt = await client.query(
      `SELECT id, purchase_order_id FROM erp_goods_receipts WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [receiptId, companyId],
    );
    if (!receipt.rowCount) throw new Error("Goods receipt not found");
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM erp_purchase_returns WHERE company_id = $1`,
      [companyId],
    );
    const returnNo = `PRTN-${new Date().getFullYear()}-${String(Number(count.rows[0].n) + 1).padStart(4, '0')}`;
    let total = 0;
    const returnHeader = await client.query(
      `INSERT INTO erp_purchase_returns (company_id, goods_receipt_id, return_no, return_date, reason, status, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'requested', $5) RETURNING *`,
      [companyId, receiptId, returnNo, reason || null, userId],
    );
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price || 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Each return line needs a positive quantity and a valid unit price");
      }
      const lineTotal = roundMoney(quantity * unitPrice);
      total = roundMoney(total + lineTotal);
      await client.query(
        `INSERT INTO erp_purchase_return_lines (company_id, purchase_return_id, goods_receipt_line_id, item_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [companyId, returnHeader.rows[0].id, line.goods_receipt_line_id, line.item_id, quantity, unitPrice, lineTotal],
      );
    }
    await client.query(
      `UPDATE erp_purchase_returns SET total_amount = $3, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [returnHeader.rows[0].id, companyId, total],
    );
    await client.query("COMMIT");
    return { ...returnHeader.rows[0], total_amount: total };
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
      `SELECT receipt_line.*, item.unit_weight
       FROM erp_goods_receipt_lines receipt_line
       JOIN erp_items item ON item.id=receipt_line.item_id AND item.company_id=receipt_line.company_id
       WHERE receipt_line.goods_receipt_id = $1 AND receipt_line.company_id = $2 AND receipt_line.is_deleted = FALSE`,
      [grnId, companyId],
    );
    if (!lines.rowCount) throw new Error("GRN has no lines");

    const landedCosts = await client.query(
      `SELECT * FROM erp_goods_receipt_landed_costs
       WHERE company_id=$1 AND goods_receipt_id=$2 ORDER BY created_at,id FOR UPDATE`,
      [companyId, grnId],
    );
    const allocationByLine = new Map(lines.rows.map((line) => [line.id, 0]));
    const acceptedLines = lines.rows.filter((line) => (line.inspection_status || "accept") !== "reject");
    for (const charge of landedCosts.rows) {
      const weights = acceptedLines.map((line) => {
        if (charge.allocation_method === "quantity") return Number(line.quantity);
        if (charge.allocation_method === "weight") {
          if (!Number.isFinite(Number(line.unit_weight)) || Number(line.unit_weight) <= 0) {
            throw new Error(`Unit weight is required to allocate landed cost for ${line.item_id}`);
          }
          return Number(line.quantity) * Number(line.unit_weight);
        }
        return Number(line.quantity) * Number(line.unit_cost);
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      if (totalWeight <= 0) throw new Error("Landed cost allocation basis must be greater than zero");
      let remaining = roundMoney(Number(charge.amount));
      for (let index = 0; index < acceptedLines.length; index += 1) {
        const allocation = index === acceptedLines.length - 1
          ? remaining
          : roundMoney(Number(charge.amount) * weights[index] / totalWeight);
        const line = acceptedLines[index];
        allocationByLine.set(line.id, roundMoney(allocationByLine.get(line.id) + allocation));
        remaining = roundMoney(remaining - allocation);
      }
    }
    for (const line of lines.rows) {
      await client.query(
        `UPDATE erp_goods_receipt_lines SET landed_cost_amount=$3 WHERE id=$1 AND company_id=$2`,
        [line.id, companyId, allocationByLine.get(line.id) || 0],
      );
      line.landed_cost_amount = allocationByLine.get(line.id) || 0;
    }

    let goodsValue = 0;
    let totalValue = 0;
    for (const line of lines.rows) {
      const inspectionStatus = line.inspection_status || "accept";
      if (!["accept", "quarantine", "reject"].includes(inspectionStatus)) {
        throw new Error("Goods receipt inspection status is invalid");
      }
      if (inspectionStatus !== "accept" && !String(line.inspection_reason || "").trim()) {
        throw new Error("Quarantined or rejected receipt lines need an inspection reason");
      }
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
      if (inspectionStatus === "reject") continue;

      const landedCost = Number(allocationByLine.get(line.id) || 0);
      const inventoryUnitCost = Number(line.unit_cost) + landedCost / Number(line.quantity);

      const receiptLayer = await recordReceipt(client, {
        companyId,
        warehouseId: grn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost: inventoryUnitCost,
        referenceType: "goods_receipt",
        referenceId: grnId,
        batchNo: line.batch_no,
        expiryDate: line.expiry_date,
        userId,
        movementDate: grn.received_date,
        allowExpiredForQuarantine: inspectionStatus === "quarantine",
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
      if (inspectionStatus === "quarantine") {
        const reason = String(line.inspection_reason).trim().slice(0, 1000);
        if (receiptLayer?.lotId) {
          const updatedLot = await client.query(
            `UPDATE erp_inventory_lots SET quarantined_quantity = quarantined_quantity + $2, updated_by = $3
             WHERE id = $1 AND company_id = $4 AND quantity - quarantined_quantity >= $2 RETURNING id`,
            [receiptLayer.lotId, line.quantity, userId, companyId],
          );
          if (!updatedLot.rowCount) throw new Error("Received lot could not be placed into quarantine");
          await inventory.adjustLotLayerQuarantine(client, {
            companyId, lotId: receiptLayer.lotId, quantity: line.quantity, action: "quarantine",
          });
          await client.query(
            `INSERT INTO erp_inventory_lot_events (company_id, warehouse_id, item_id, lot_id, event_type, quantity, reason, created_by)
             VALUES ($1,$2,$3,$4,'quarantined',$5,$6,$7)`,
            [companyId, grn.warehouse_id, line.item_id, receiptLayer.lotId, line.quantity, reason, userId],
          );
        } else {
          await client.query(
            `INSERT INTO erp_inventory_quarantine_balances (company_id, warehouse_id, item_id, quantity, updated_by)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id, warehouse_id, item_id)
             DO UPDATE SET quantity = erp_inventory_quarantine_balances.quantity + EXCLUDED.quantity,
               updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
            [companyId, grn.warehouse_id, line.item_id, line.quantity, userId],
          );
          await client.query(
            `INSERT INTO erp_inventory_quarantine_events (company_id, warehouse_id, item_id, source_type, source_id, event_type, quantity, reason, created_by)
             VALUES ($1,$2,$3,'goods_receipt',$4,'quarantined',$5,$6,$7)`,
            [companyId, grn.warehouse_id, line.item_id, grnId, line.quantity, reason, userId],
          );
        }
      }
      goodsValue += Number(line.quantity) * Number(line.unit_cost);
      totalValue += Number(line.quantity) * inventoryUnitCost;

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
        const landedAccountIds = [...new Set(landedCosts.rows.map((charge) => charge.credit_account_id))];
        const landedAccounts = landedAccountIds.length ? await client.query(
          `SELECT id, account_code FROM erp_chart_of_accounts
           WHERE company_id=$1 AND id=ANY($2::uuid[]) AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE`,
          [companyId, landedAccountIds],
        ) : { rows: [] };
        const landedAccountById = new Map(landedAccounts.rows.map((account) => [account.id, account]));
        for (const accountId of landedAccountIds) {
          if (!landedAccountById.has(accountId)) throw new Error("A landed-cost clearing account is unavailable or not postable");
        }
        const landedCredits = new Map();
        for (const charge of landedCosts.rows) {
          landedCredits.set(charge.credit_account_id,
            roundMoney((landedCredits.get(charge.credit_account_id) || 0) + Number(charge.amount)));
        }
        const journalLines = [
          { account_id: byCode["1300"], debit: totalValue, credit: 0, description: "Inventory including allocated landed costs" },
        ];
        if (goodsValue > 0) journalLines.push({
          account_id: byCode["2150"], debit: 0, credit: goodsValue, description: "Goods received not invoiced" });
        for (const [accountId, amount] of landedCredits) journalLines.push({
          account_id: accountId, debit: 0, credit: amount,
          description: `Landed costs: ${landedAccountById.get(accountId)?.account_code || "clearing"}`,
        });
        const journal = await gl.createJournalInTransaction(client, {
          companyId,
          userId,
          entryDate: grn.received_date,
          journalType: "purchase",
          referenceNo: grn.grn_number,
          description: `GRN stock receipt ${grn.grn_number}`,
          lines: journalLines,
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
    await etimsEvents.queueEtimsStockMovementInTransaction(client, {
      companyId,
      userId,
      sourceType: "goods_receipt",
      sourceId: grnId,
      eventType: "goods_receipt",
      occurredDate: grn.received_date,
      lines: lines.rows.filter((line) => (line.inspection_status || "accept") !== "reject")
        .map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost) })),
    });
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
  landedCosts = [],
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
    if (!Array.isArray(landedCosts) || landedCosts.length > 20) throw new Error("Landed costs must contain no more than 20 charges");
    for (const charge of landedCosts) {
      const amount = Number(charge.amount);
      const description = String(charge.description || "").trim();
      if (!description || !Number.isFinite(amount) || amount <= 0
          || !charge.credit_account_id || !["value", "quantity", "weight"].includes(String(charge.allocation_method))) {
        throw new Error("Each landed-cost charge needs a description, positive amount, clearing account, and allocation method");
      }
      const account = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE id=$1 AND company_id=$2
           AND account_type IN ('asset','liability') AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE`,
        [charge.credit_account_id, companyId],
      );
      if (!account.rowCount) throw new Error("Choose an active postable asset or liability clearing account for landed costs");
    }
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
      const inspectionStatus = String(line.inspection_status || "accept");
      if (!["accept", "quarantine", "reject"].includes(inspectionStatus)) throw new Error("Goods receipt inspection status is invalid");
      if (inspectionStatus !== "accept" && !String(line.inspection_reason || "").trim()) {
        throw new Error("Quarantined or rejected receipt lines need an inspection reason");
      }
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

    for (const charge of landedCosts) {
      await client.query(
        `INSERT INTO erp_goods_receipt_landed_costs
           (company_id, goods_receipt_id, description, amount, credit_account_id, allocation_method, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId, grn.id, String(charge.description).trim().slice(0, 200), Number(charge.amount),
          charge.credit_account_id, charge.allocation_method, userId],
      );
    }

    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO erp_goods_receipt_lines (
           company_id, goods_receipt_id, po_line_id, line_no, item_id, quantity, unit_cost,
           batch_no, expiry_date, created_by, inspection_status, inspection_reason
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
          String(line.inspection_status || "accept"),
          line.inspection_reason || null,
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
  createPurchaseRequisition,
  approvePurchaseRequisition,
  createPurchaseOrder,
  approvePurchaseOrder,
  createRfqFromRequisition,
  addSupplierToRfq,
  submitRfqQuote,
  awardRfq,
  createPurchaseOrderFromRfq,
  amendPurchaseOrder,
  createPurchaseReturn,
  postGoodsReceipt,
  createAndPostGrn,
};
