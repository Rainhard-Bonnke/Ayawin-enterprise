const pool = require('../db');
const { recordReceipt, recordIssue, publishInventoryUpdate } = require('./inventoryService');
const { normalizeReasonCode, formatReason } = require('../lib/inventoryReasonCodes');
const { logAudit } = require('./auditService');

async function nextAdjNo(client, companyId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM erp_stock_adjustments WHERE company_id = $1`,
    [companyId],
  );
  return `ADJ-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(4, '0')}`;
}

async function createStockAdjustment({ companyId, userId, warehouseId, reason, reasonCode, lines }) {
  if (!lines?.length) throw new Error('Adjustment lines required');
  const code = normalizeReasonCode(reasonCode || 'OTHER');
  const reasonText = formatReason(code, reason);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adjNo = await nextAdjNo(client, companyId);
    const adjResult = await client.query(
      `INSERT INTO erp_stock_adjustments (
         company_id, warehouse_id, adjustment_no, reason, reason_code, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
      [companyId, warehouseId, adjNo, reasonText, code, userId],
    );
    const adj = adjResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      const delta = Number(line.quantity_delta);
      if (!delta) throw new Error('quantity_delta cannot be zero');
      await client.query(
        `INSERT INTO erp_stock_adjustment_lines (
           company_id, adjustment_id, line_no, item_id, quantity_delta, unit_cost, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId, adj.id, lineNo++, line.item_id, delta, line.unit_cost || 0, userId],
      );
    }
    await logAudit({
      companyId,
      userId,
      entityType: 'stock_adjustment',
      entityId: adj.id,
      action: 'adjustment.created',
      newValues: { adjustment_no: adj.adjustment_no, status: 'draft', reason: reasonText },
      client,
    });
    await client.query('COMMIT');
    return adj;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postStockAdjustment({ companyId, userId, adjustmentId, approverId }) {
  if (!approverId) throw new Error('Approver is required to post stock adjustments');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adj = await client.query(
      `SELECT * FROM erp_stock_adjustments WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [adjustmentId, companyId],
    );
    if (!adj.rowCount) throw new Error('Adjustment not found or already posted');
    const row = adj.rows[0];

    const lines = await client.query(
      `SELECT * FROM erp_stock_adjustment_lines WHERE adjustment_id = $1 ORDER BY line_no`,
      [adjustmentId],
    );

    for (const line of lines.rows) {
      const delta = Number(line.quantity_delta);
      if (delta > 0) {
        await recordReceipt(client, {
          companyId,
          warehouseId: row.warehouse_id,
          itemId: line.item_id,
          quantity: delta,
          unitCost: line.unit_cost || 0,
          referenceType: 'adjustment',
          referenceId: adjustmentId,
          userId: approverId,
          movementDate: row.adjustment_date,
        });
      } else {
        await recordIssue(client, {
          companyId,
          warehouseId: row.warehouse_id,
          itemId: line.item_id,
          quantity: Math.abs(delta),
          unitCost: line.unit_cost || 0,
          referenceType: 'adjustment',
          referenceId: adjustmentId,
          userId: approverId,
        });
      }
    }

    await client.query(
      `UPDATE erp_stock_adjustments
       SET status = 'posted', posted_at = NOW(), updated_at = NOW(), updated_by = $3, approved_by = $3
       WHERE id = $1 AND company_id = $2`,
      [adjustmentId, companyId, approverId],
    );

    await logAudit({
      companyId,
      userId: approverId,
      entityType: 'stock_adjustment',
      entityId: adjustmentId,
      action: 'adjustment.posted',
      newValues: { status: 'posted', approved_by: approverId },
      client,
    });
    await client.query('COMMIT');
    publishInventoryUpdate(companyId, { adjustment_id: adjustmentId, approved_by: approverId });
    return { ok: true, adjustment_id: adjustmentId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createStockAdjustment,
  postStockAdjustment,
};
