const pool = require('../db');

async function getStockOnHand(companyId, { warehouseId, itemId, q = '' } = {}) {
  const params = [companyId];
  let filter = '';
  if (warehouseId) {
    params.push(warehouseId);
    filter += ` AND s.warehouse_id = $${params.length}`;
  }
  if (itemId) {
    params.push(itemId);
    filter += ` AND s.item_id = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    filter += ` AND (i.item_code ILIKE $${params.length} OR i.name ILIKE $${params.length})`;
  }

  const result = await pool.query(
    `SELECT s.*, i.item_code, i.name AS item_name, i.reorder_point,
            w.code AS warehouse_code, w.name AS warehouse_name,
            (s.quantity * s.avg_unit_cost) AS stock_value
     FROM erp_stock_on_hand s
     JOIN erp_items i ON i.id = s.item_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     WHERE s.company_id = $1 AND s.is_deleted = FALSE ${filter}
     ORDER BY w.name, i.item_code`,
    params,
  );
  return result.rows;
}

async function recordReceipt(client, {
  companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId,
  batchNo, expiryDate, userId, movementDate,
}) {
  await client.query(
    `INSERT INTO erp_stock_ledger (
       company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
       reference_type, reference_id, batch_no, expiry_date, movement_date, created_by
     ) VALUES ($1,$2,$3,'receipt',$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),$11)`,
    [companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId, batchNo, expiryDate, movementDate, userId],
  );

  const existing = await client.query(
    `SELECT * FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
    [companyId, warehouseId, itemId],
  );

  if (existing.rowCount === 0) {
    await client.query(
      `INSERT INTO erp_stock_on_hand (company_id, warehouse_id, item_id, quantity, avg_unit_cost, last_movement_at, created_by)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
      [companyId, warehouseId, itemId, quantity, unitCost, userId],
    );
    return;
  }

  const row = existing.rows[0];
  const newQty = Number(row.quantity) + Number(quantity);
  const newAvg = newQty > 0
    ? ((Number(row.quantity) * Number(row.avg_unit_cost)) + (Number(quantity) * Number(unitCost))) / newQty
    : unitCost;

  await client.query(
    `UPDATE erp_stock_on_hand
     SET quantity = $4, avg_unit_cost = $5, last_movement_at = NOW(), updated_at = NOW(), updated_by = $6
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [companyId, warehouseId, itemId, newQty, newAvg, userId],
  );
}

async function recordIssue(client, {
  companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId, userId,
}) {
  const stock = await client.query(
    `SELECT quantity, avg_unit_cost FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
    [companyId, warehouseId, itemId],
  );
  if (!stock.rowCount || Number(stock.rows[0].quantity) < Number(quantity)) {
    throw new Error(`Insufficient stock for item ${itemId}`);
  }

  const cost = unitCost ?? stock.rows[0].avg_unit_cost;
  await client.query(
    `INSERT INTO erp_stock_ledger (
       company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
       reference_type, reference_id, created_by
     ) VALUES ($1,$2,$3,'issue',(0 - $4::numeric),$5,$6,$7,$8)`,
    [companyId, warehouseId, itemId, quantity, cost, referenceType, referenceId, userId],
  );

  const newQty = Number(stock.rows[0].quantity) - Number(quantity);
  await client.query(
    `UPDATE erp_stock_on_hand SET quantity = $4, last_movement_at = NOW(), updated_at = NOW(), updated_by = $5
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [companyId, warehouseId, itemId, newQty, userId],
  );
  return cost;
}

async function getReorderAlerts(companyId) {
  const result = await pool.query(
    `SELECT s.*, i.item_code, i.name AS item_name, i.reorder_point, w.name AS warehouse_name
     FROM erp_stock_on_hand s
     JOIN erp_items i ON i.id = s.item_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     WHERE s.company_id = $1 AND i.reorder_point > 0 AND s.quantity <= i.reorder_point
     ORDER BY s.quantity ASC`,
    [companyId],
  );
  return result.rows;
}

module.exports = { getStockOnHand, recordReceipt, recordIssue, getReorderAlerts };
