const pool = require('../db');
const { recordReceipt, publishInventoryUpdate } = require('./inventoryService');
const gl = require('./glPostingService');

const PO_MD_THRESHOLD = Number(process.env.PO_MD_APPROVAL_THRESHOLD || 100_000);

function canMdApprove(user) {
  const role = String(user?.role_name || '');
  if (/administrator|managing director|director/i.test(role)) return true;
  return (user?.permissions || []).includes('procurement.md_approve');
}

function requiresMdApproval(totalAmount) {
  return Number(totalAmount) > PO_MD_THRESHOLD;
}

function allocateLandedCost(lines, landedCostTotal) {
  const total = Number(landedCostTotal || 0);
  if (!total || !lines.length) {
    return lines.map((l) => ({ ...l, effectiveUnitCost: Number(l.unit_cost) }));
  }
  const bases = lines.map((l) => Number(l.quantity) * Number(l.unit_cost));
  const baseSum = bases.reduce((s, v) => s + v, 0) || 1;
  return lines.map((line, i) => {
    const qty = Number(line.quantity);
    const share = (bases[i] / baseSum) * total;
    const lineValue = bases[i] + share;
    return { ...line, effectiveUnitCost: qty > 0 ? lineValue / qty : Number(line.unit_cost) };
  });
}

async function assertVendorForPo(client, companyId, vendorId) {
  const db = client?.query ? client : pool;
  const result = await db.query(
    `SELECT id, name, is_active FROM erp_vendors
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [vendorId, companyId],
  );
  if (!result.rowCount) throw new Error('Supplier not found for this company');
  if (result.rows[0].is_active === false) throw new Error('Supplier is inactive — cannot raise PO');
  return result.rows[0];
}

async function nextDocNo(client, companyId, table, column, prefix) {
  const result = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`, [companyId]);
  return `${prefix}-${new Date().getFullYear()}-${String(Number(result.rows[0].n) + 1).padStart(4, '0')}`;
}

async function createPurchaseOrder({
  companyId, userId, vendorId, warehouseId, requisitionId, lines, expectedDate, notes,
}) {
  if (!lines?.length) throw new Error('PO lines required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertVendorForPo(client, companyId, vendorId);
    const poNumber = await nextDocNo(client, companyId, 'erp_purchase_orders', 'po_number', 'PO');
    let subtotal = 0;
    for (const line of lines) {
      subtotal += Number(line.quantity) * Number(line.unit_cost);
    }

    const mdRequired = requiresMdApproval(subtotal);
    const poResult = await client.query(
      `INSERT INTO erp_purchase_orders (
         company_id, vendor_id, warehouse_id, requisition_id, po_number, expected_date,
         status, subtotal, total_amount, notes, requires_md_approval, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$7,$8,$9,$10) RETURNING *`,
      [companyId, vendorId, warehouseId, requisitionId, poNumber, expectedDate, subtotal, notes, mdRequired, userId],
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

    await client.query('COMMIT');
    return po;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function approvePurchaseOrder({ companyId, userId, poId, actor }) {
  const current = await pool.query(
    `SELECT * FROM erp_purchase_orders WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [poId, companyId],
  );
  const po = current.rows[0];
  if (!po) throw new Error('PO not found');
  if (po.status === 'pending_md_approval') {
    if (!canMdApprove(actor)) {
      throw new Error(`Managing Director approval required for POs above KES ${PO_MD_THRESHOLD.toLocaleString()}`);
    }
    const result = await pool.query(
      `UPDATE erp_purchase_orders
       SET status = 'approved', md_approved_by = $3, md_approved_at = NOW(), updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2 AND status = 'pending_md_approval' RETURNING *`,
      [poId, companyId, userId],
    );
    if (!result.rowCount) throw new Error('PO not found or cannot MD-approve');
    return result.rows[0];
  }
  if (!['draft', 'submitted'].includes(po.status)) throw new Error('PO not found or cannot approve');

  const needsMd = po.requires_md_approval || requiresMdApproval(po.total_amount);
  const nextStatus = needsMd ? 'pending_md_approval' : 'approved';
  if (needsMd && canMdApprove(actor)) {
    const result = await pool.query(
      `UPDATE erp_purchase_orders
       SET status = 'approved', requires_md_approval = TRUE, md_approved_by = $3, md_approved_at = NOW(),
           updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [poId, companyId, userId],
    );
    return result.rows[0];
  }

  const result = await pool.query(
    `UPDATE erp_purchase_orders
     SET status = $4, requires_md_approval = $5, updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND status IN ('draft','submitted') RETURNING *`,
    [poId, companyId, userId, nextStatus, needsMd],
  );
  if (!result.rowCount) throw new Error('PO not found or cannot approve');
  return result.rows[0];
}

async function sendPurchaseOrderToSupplier({ companyId, userId, poId }) {
  const result = await pool.query(
    `UPDATE erp_purchase_orders
     SET status = 'sent', updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND status IN ('approved','pending_md_approval')
     RETURNING *`,
    [poId, companyId, userId],
  );
  if (!result.rowCount) throw new Error('PO not found or not approved for sending');
  return result.rows[0];
}

async function updatePurchaseOrder({
  companyId, userId, poId, vendorId, warehouseId, lines, notes, expectedDate,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT * FROM erp_purchase_orders WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [poId, companyId],
    );
    const po = current.rows[0];
    if (!po) throw new Error('PO not found');

    const received = await client.query(
      `SELECT COALESCE(SUM(qty_received), 0)::numeric AS qty FROM erp_purchase_order_lines WHERE purchase_order_id = $1`,
      [poId],
    );
    if (Number(received.rows[0].qty) > 0 && lines?.length) {
      throw new Error('Cannot change PO lines after goods receipt — amend notes only or complete receiving');
    }

    const editable = ['draft', 'submitted'];
    const needsReapproval = !editable.includes(po.status);
    if (!editable.includes(po.status) && !['approved', 'sent', 'pending_md_approval'].includes(po.status)) {
      throw new Error(`PO cannot be edited in status ${po.status}`);
    }

    if (vendorId) await assertVendorForPo(client, companyId, vendorId);

    let subtotal = Number(po.subtotal);
    let mdRequired = Boolean(po.requires_md_approval);
    if (lines?.length) {
      subtotal = 0;
      for (const line of lines) subtotal += Number(line.quantity) * Number(line.unit_cost);
      mdRequired = requiresMdApproval(subtotal);
      await client.query(
        `DELETE FROM erp_purchase_order_lines WHERE purchase_order_id = $1 AND company_id = $2`,
        [poId, companyId],
      );
      let lineNo = 1;
      for (const line of lines) {
        const lt = Number(line.quantity) * Number(line.unit_cost);
        await client.query(
          `INSERT INTO erp_purchase_order_lines (
             company_id, purchase_order_id, line_no, item_id, quantity, unit_cost, line_total, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, poId, lineNo++, line.item_id, line.quantity, line.unit_cost, lt, userId],
        );
      }
    }

    const nextStatus = needsReapproval ? 'draft' : po.status;
    const result = await client.query(
      `UPDATE erp_purchase_orders
       SET vendor_id = COALESCE($4, vendor_id),
           warehouse_id = COALESCE($5, warehouse_id),
           expected_date = COALESCE($6, expected_date),
           notes = COALESCE($7, notes),
           subtotal = $8,
           total_amount = $8,
           requires_md_approval = $9,
           status = $10,
           revision_no = revision_no + CASE WHEN $11 THEN 1 ELSE 0 END,
           amended_at = CASE WHEN $11 THEN NOW() ELSE amended_at END,
           amended_by = CASE WHEN $11 THEN $3 ELSE amended_by END,
           md_approved_by = CASE WHEN $11 THEN NULL ELSE md_approved_by END,
           md_approved_at = CASE WHEN $11 THEN NULL ELSE md_approved_at END,
           updated_at = NOW(),
           updated_by = $3
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [
        poId, companyId, userId, vendorId || null, warehouseId || null, expectedDate || null,
        notes !== undefined ? notes : null, subtotal, mdRequired, nextStatus, needsReapproval,
      ],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postGoodsReceipt({ companyId, userId, grnId, postGl = true, landedCostTotal = 0 }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const grnResult = await client.query(
      `SELECT g.*, po.vendor_id FROM erp_goods_receipts g
       JOIN erp_purchase_orders po ON po.id = g.purchase_order_id
       WHERE g.id = $1 AND g.company_id = $2 AND g.status = 'draft' FOR UPDATE`,
      [grnId, companyId],
    );
    const grn = grnResult.rows[0];
    if (!grn) throw new Error('GRN not found or already posted');

    const lines = await client.query(
      `SELECT * FROM erp_goods_receipt_lines WHERE goods_receipt_id = $1`,
      [grnId],
    );
    if (!lines.rowCount) throw new Error('GRN has no lines');

    const landed = Number(landedCostTotal || grn.landed_cost_total || 0);
    const costedLines = allocateLandedCost(lines.rows, landed);

    let totalValue = 0;
    for (const line of costedLines) {
      if (line.po_line_id) {
        const poLine = await client.query(
          `SELECT quantity, qty_received FROM erp_purchase_order_lines WHERE id = $1`,
          [line.po_line_id],
        );
        if (poLine.rowCount) {
          const open = Number(poLine.rows[0].quantity) - Number(poLine.rows[0].qty_received);
          if (Number(line.quantity) > open + 0.0001) {
            throw new Error(`Receipt quantity ${line.quantity} exceeds open PO quantity ${open}`);
          }
        }
      }
      const unitCost = line.effectiveUnitCost ?? line.unit_cost;
      await recordReceipt(client, {
        companyId,
        warehouseId: grn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost,
        referenceType: 'goods_receipt',
        referenceId: grnId,
        batchNo: line.batch_no,
        expiryDate: line.expiry_date,
        userId,
        movementDate: grn.received_date,
      });
      totalValue += Number(line.quantity) * unitCost;

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
      `UPDATE erp_goods_receipts
       SET status = 'posted', posted_at = NOW(), posted_by = $3, landed_cost_total = $4, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [grnId, companyId, userId, landed],
    );

    await client.query(
      `UPDATE erp_purchase_orders po SET status = CASE
         WHEN (SELECT COALESCE(SUM(qty_received),0) FROM erp_purchase_order_lines WHERE purchase_order_id = po.id)
              >= (SELECT COALESCE(SUM(quantity),0) FROM erp_purchase_order_lines WHERE purchase_order_id = po.id)
         THEN 'received' ELSE 'partial' END
       WHERE id = $1`,
      [grn.purchase_order_id],
    );

    await client.query('COMMIT');

    let journalId = null;
    if (postGl && totalValue > 0) {
      const accounts = await pool.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code IN ('1300','2100')`,
        [companyId],
      );
      const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
      if (byCode['1300'] && byCode['2100']) {
        const journal = await gl.createJournal({
          companyId,
          userId,
          entryDate: grn.received_date,
          journalType: 'purchase',
          referenceNo: grn.grn_number,
          description: `GRN stock receipt ${grn.grn_number}`,
          lines: [
            { account_id: byCode['1300'], debit: totalValue, credit: 0, description: 'Inventory' },
            { account_id: byCode['2100'], debit: 0, credit: totalValue, description: 'AP accrual' },
          ],
        });
        await gl.postJournal({ journalId: journal.id, companyId, userId });
        journalId = journal.id;
        await pool.query('UPDATE erp_goods_receipts SET journal_id = $1 WHERE id = $2', [journalId, grnId]);
      }
    }

    publishInventoryUpdate(companyId, { grn_id: grnId, type: 'goods_receipt' });
    return { ok: true, grn_id: grnId, journal_id: journalId, total_value: totalValue };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function createPurchaseRequisition({
  companyId, userId, warehouseId, requiredDate, notes, lines,
}) {
  if (!lines?.length) throw new Error('Requisition lines required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqNo = await nextDocNo(client, companyId, 'erp_purchase_requisitions', 'requisition_no', 'PR');
    const reqResult = await client.query(
      `INSERT INTO erp_purchase_requisitions (
         company_id, requisition_no, requester_id, required_date, status, notes, created_by
       ) VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING *`,
      [companyId, reqNo, userId, requiredDate, notes, userId],
    );
    const req = reqResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO erp_purchase_requisition_lines (
           company_id, requisition_id, line_no, item_id, quantity, estimated_unit_cost, warehouse_id, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, req.id, lineNo++, line.item_id, line.quantity, line.estimated_unit_cost || 0, line.warehouse_id || warehouseId, userId],
      );
    }

    await client.query('COMMIT');
    return req;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function submitPurchaseRequisition({ companyId, userId, requisitionId }) {
  const result = await pool.query(
    `UPDATE erp_purchase_requisitions SET status = 'submitted', updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING *`,
    [requisitionId, companyId, userId],
  );
  if (!result.rowCount) throw new Error('Requisition not found or cannot submit');
  return result.rows[0];
}

async function approvePurchaseRequisition({ companyId, userId, requisitionId }) {
  const result = await pool.query(
    `UPDATE erp_purchase_requisitions SET status = 'approved', updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND status IN ('draft','submitted') RETURNING *`,
    [requisitionId, companyId, userId],
  );
  if (!result.rowCount) throw new Error('Requisition not found or cannot approve');
  return result.rows[0];
}

async function createAndPostGrn({
  companyId, userId, purchaseOrderId, warehouseId, lines, receivedDate, notes, landedCostTotal,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const poCheck = await client.query(
      `SELECT status FROM erp_purchase_orders WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [purchaseOrderId, companyId],
    );
    if (!poCheck.rowCount || !['approved', 'sent'].includes(poCheck.rows[0].status)) {
      throw new Error('Purchase order must be fully approved before goods receipt');
    }
    const grnNumber = await nextDocNo(client, companyId, 'erp_goods_receipts', 'grn_number', 'GRN');
    const grnResult = await client.query(
      `INSERT INTO erp_goods_receipts (
         company_id, purchase_order_id, warehouse_id, grn_number, received_date, status, notes,
         landed_cost_total, created_by
       ) VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),'draft',$6,$7,$8) RETURNING *`,
      [companyId, purchaseOrderId, warehouseId, grnNumber, receivedDate, notes, Number(landedCostTotal || 0), userId],
    );
    const grn = grnResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      if (line.po_line_id) {
        const poLine = await client.query(
          `SELECT quantity, qty_received FROM erp_purchase_order_lines WHERE id = $1`,
          [line.po_line_id],
        );
        if (poLine.rowCount) {
          const open = Number(poLine.rows[0].quantity) - Number(poLine.rows[0].qty_received);
          if (Number(line.quantity) > open + 0.0001) {
            throw new Error(`Cannot receive ${line.quantity}; only ${open} remaining on PO line`);
          }
        }
      }
      await client.query(
        `INSERT INTO erp_goods_receipt_lines (
           company_id, goods_receipt_id, po_line_id, line_no, item_id, quantity, unit_cost, batch_no, expiry_date, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [companyId, grn.id, line.po_line_id, lineNo++, line.item_id, line.quantity, line.unit_cost, line.batch_no, line.expiry_date, userId],
      );
    }
    await client.query('COMMIT');

    return postGoodsReceipt({
      companyId, userId, grnId: grn.id, landedCostTotal: Number(landedCostTotal || 0),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrderToSupplier,
  assertVendorForPo,
  allocateLandedCost,
  canMdApprove,
  requiresMdApproval,
  PO_MD_THRESHOLD,
  createPurchaseRequisition,
  submitPurchaseRequisition,
  approvePurchaseRequisition,
  postGoodsReceipt,
  createAndPostGrn,
};
