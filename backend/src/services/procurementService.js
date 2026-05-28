const pool = require('../db');
const { recordReceipt } = require('./inventoryService');
const gl = require('./glPostingService');

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
    const poNumber = await nextDocNo(client, companyId, 'erp_purchase_orders', 'po_number', 'PO');
    let subtotal = 0;
    for (const line of lines) {
      subtotal += Number(line.quantity) * Number(line.unit_cost);
    }

    const poResult = await client.query(
      `INSERT INTO erp_purchase_orders (
         company_id, vendor_id, warehouse_id, requisition_id, po_number, expected_date,
         status, subtotal, total_amount, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$7,$8,$9) RETURNING *`,
      [companyId, vendorId, warehouseId, requisitionId, poNumber, expectedDate, subtotal, notes, userId],
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

async function approvePurchaseOrder({ companyId, userId, poId }) {
  const result = await pool.query(
    `UPDATE erp_purchase_orders SET status = 'approved', updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND status IN ('draft','submitted') RETURNING *`,
    [poId, companyId, userId],
  );
  if (!result.rowCount) throw new Error('PO not found or cannot approve');
  return result.rows[0];
}

async function postGoodsReceipt({ companyId, userId, grnId, postGl = true }) {
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

    let totalValue = 0;
    for (const line of lines.rows) {
      await recordReceipt(client, {
        companyId,
        warehouseId: grn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost: line.unit_cost,
        referenceType: 'goods_receipt',
        referenceId: grnId,
        batchNo: line.batch_no,
        expiryDate: line.expiry_date,
        userId,
        movementDate: grn.received_date,
      });
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
      `UPDATE erp_goods_receipts SET status = 'posted', posted_at = NOW(), posted_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [grnId, companyId, userId],
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

    return { ok: true, grn_id: grnId, journal_id: journalId, total_value: totalValue };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function createAndPostGrn({
  companyId, userId, purchaseOrderId, warehouseId, lines, receivedDate, notes,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const grnNumber = await nextDocNo(client, companyId, 'erp_goods_receipts', 'grn_number', 'GRN');
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
        [companyId, grn.id, line.po_line_id, lineNo++, line.item_id, line.quantity, line.unit_cost, line.batch_no, line.expiry_date, userId],
      );
    }
    await client.query('COMMIT');

    return postGoodsReceipt({ companyId, userId, grnId: grn.id });
  } catch (err) {
    await client.query('ROLLBACK');
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
