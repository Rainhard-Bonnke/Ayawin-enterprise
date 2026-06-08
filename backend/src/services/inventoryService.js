const pool = require('../db');
const liveEvents = require('./liveEventsService');

function publishInventoryUpdate(companyId, details = {}) {
  liveEvents.publish(companyId, 'inventory.updated', details);
}

async function checkLowStockAndPublish(companyId, warehouseId, itemId) {
  if (!warehouseId || !itemId) return;
  const r = await pool.query(
    `SELECT s.quantity, i.reorder_point, i.item_code, i.name AS item_name
     FROM erp_stock_on_hand s
     JOIN erp_items i ON i.id = s.item_id
     WHERE s.company_id = $1 AND s.warehouse_id = $2 AND s.item_id = $3 AND i.reorder_point > 0`,
    [companyId, warehouseId, itemId],
  );
  if (!r.rowCount) return;
  const row = r.rows[0];
  if (Number(row.quantity) <= Number(row.reorder_point)) {
    liveEvents.publish(companyId, 'stock.low', {
      item_id: itemId,
      warehouse_id: warehouseId,
      item_code: row.item_code,
      item_name: row.item_name,
      quantity: Number(row.quantity),
      reorder_point: Number(row.reorder_point),
    });
  }
}

async function afterStockMovement(companyId, { warehouseId, itemId, ...details }) {
  publishInventoryUpdate(companyId, { warehouse_id: warehouseId, item_id: itemId, ...details });
  await checkLowStockAndPublish(companyId, warehouseId, itemId);
}

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
    const p = `$${params.length}`;
    filter += ` AND (i.item_code ILIKE ${p} OR i.name ILIKE ${p} OR COALESCE(i.barcode, '') ILIKE ${p})`;
  }

  const result = await pool.query(
    `SELECT s.*, i.item_code, i.name AS item_name, i.reorder_point, i.barcode,
            w.code AS warehouse_code, w.name AS warehouse_name,
            (s.quantity * s.avg_unit_cost) AS stock_value,
            batch_agg.nearest_expiry,
            batch_agg.batch_count
     FROM erp_stock_on_hand s
     JOIN erp_items i ON i.id = s.item_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     LEFT JOIN LATERAL (
       SELECT MIN(sl.expiry_date) FILTER (WHERE sl.expiry_date IS NOT NULL) AS nearest_expiry,
              COUNT(DISTINCT sl.batch_no) FILTER (WHERE sl.batch_no IS NOT NULL AND sl.quantity > 0) AS batch_count
       FROM erp_stock_ledger sl
       WHERE sl.company_id = s.company_id
         AND sl.warehouse_id = s.warehouse_id
         AND sl.item_id = s.item_id
         AND sl.batch_no IS NOT NULL
     ) batch_agg ON TRUE
     WHERE s.company_id = $1 AND s.is_deleted = FALSE ${filter}
     ORDER BY w.name, i.item_code`,
    params,
  );
  return result.rows;
}

async function lookupByBarcode(companyId, barcode) {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('barcode is required');
  const result = await pool.query(
    `SELECT i.id AS item_id, i.item_code, i.name AS item_name, i.barcode, i.reorder_point,
            s.warehouse_id, w.name AS warehouse_name, s.quantity, s.avg_unit_cost
     FROM erp_items i
     LEFT JOIN erp_stock_on_hand s ON s.item_id = i.id AND s.company_id = i.company_id AND s.is_deleted = FALSE
     LEFT JOIN erp_warehouses w ON w.id = s.warehouse_id
     WHERE i.company_id = $1 AND i.is_deleted = FALSE
       AND (i.barcode = $2 OR i.item_code ILIKE $2)
     ORDER BY s.quantity DESC NULLS LAST
     LIMIT 20`,
    [companyId, code],
  );
  if (!result.rowCount) throw new Error('No product found for this barcode or SKU');
  return result.rows;
}

async function getBatchBalances(client, companyId, warehouseId, itemId) {
  const db = client?.query ? client : pool;
  const result = await db.query(
    `SELECT batch_no, expiry_date, SUM(quantity)::numeric AS quantity
     FROM erp_stock_ledger
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND batch_no IS NOT NULL
     GROUP BY batch_no, expiry_date
     HAVING SUM(quantity) > 0
     ORDER BY expiry_date ASC NULLS LAST, batch_no`,
    [companyId, warehouseId, itemId],
  );
  return result.rows;
}

async function getFefoPickPlan(companyId, warehouseId, itemId, quantity) {
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new Error('quantity must be positive');

  const batches = await getBatchBalances(pool, companyId, warehouseId, itemId);
  const stock = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [companyId, warehouseId, itemId],
  );
  const onHand = Number(stock.rows[0]?.quantity || 0);
  if (onHand < qty) {
    throw new Error(`Insufficient stock (available ${onHand}, requested ${qty})`);
  }

  let remaining = qty;
  const plan = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const available = Number(b.quantity);
    const take = Math.min(remaining, available);
    if (take > 0) {
      plan.push({
        batch_no: b.batch_no,
        expiry_date: b.expiry_date,
        quantity: take,
      });
      remaining -= take;
    }
  }
  if (remaining > 0) {
    plan.push({ batch_no: null, expiry_date: null, quantity: remaining });
  }
  return { quantity: qty, picks: plan, on_hand: onHand };
}

async function applyStockOnHandDelta(client, {
  companyId, warehouseId, itemId, quantityDelta, unitCost, userId,
}) {
  const existing = await client.query(
    `SELECT * FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
    [companyId, warehouseId, itemId],
  );

  if (quantityDelta < 0 && existing.rowCount) {
    const newQty = Number(existing.rows[0].quantity) + quantityDelta;
    if (newQty < 0) {
      throw new Error(`Insufficient stock for item ${itemId}`);
    }
  }

  if (existing.rowCount === 0) {
    if (quantityDelta < 0) throw new Error(`Insufficient stock for item ${itemId}`);
    await client.query(
      `INSERT INTO erp_stock_on_hand (company_id, warehouse_id, item_id, quantity, avg_unit_cost, last_movement_at, created_by)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
      [companyId, warehouseId, itemId, quantityDelta, unitCost, userId],
    );
    return;
  }

  const row = existing.rows[0];
  const newQty = Number(row.quantity) + Number(quantityDelta);
  if (newQty < 0) throw new Error(`Insufficient stock for item ${itemId}`);

  const newAvg =
    quantityDelta > 0 && newQty > 0
      ? ((Number(row.quantity) * Number(row.avg_unit_cost)) + quantityDelta * Number(unitCost)) / newQty
      : row.avg_unit_cost;

  await client.query(
    `UPDATE erp_stock_on_hand
     SET quantity = $4, avg_unit_cost = $5, last_movement_at = NOW(), updated_at = NOW(), updated_by = $6
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [companyId, warehouseId, itemId, newQty, newAvg, userId],
  );
}

async function recordReceipt(client, {
  companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId,
  batchNo, expiryDate, userId, movementDate,
}) {
  const qty = Number(quantity);
  await client.query(
    `INSERT INTO erp_stock_ledger (
       company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
       reference_type, reference_id, batch_no, expiry_date, movement_date, created_by
     ) VALUES ($1,$2,$3,'receipt',$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),$11)`,
    [companyId, warehouseId, itemId, qty, unitCost, referenceType, referenceId, batchNo || null, expiryDate || null, movementDate, userId],
  );

  await applyStockOnHandDelta(client, {
    companyId, warehouseId, itemId, quantityDelta: qty, unitCost: Number(unitCost || 0), userId,
  });
}

async function recordIssue(client, {
  companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId, userId,
  useFefo = true, batchNo, expiryDate,
}) {
  if (useFefo && !batchNo) {
    return recordIssueFefo(client, {
      companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId, userId,
    });
  }

  const stock = await client.query(
    `SELECT quantity, avg_unit_cost FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
    [companyId, warehouseId, itemId],
  );
  if (!stock.rowCount || Number(stock.rows[0].quantity) < Number(quantity)) {
    throw new Error(`Insufficient stock for item ${itemId}`);
  }

  const cost = unitCost ?? stock.rows[0].avg_unit_cost;
  const qty = Number(quantity);
  await client.query(
    `INSERT INTO erp_stock_ledger (
       company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
       reference_type, reference_id, batch_no, expiry_date, created_by
     ) VALUES ($1,$2,$3,'issue',(0 - $4::numeric),$5,$6,$7,$8,$9,$10)`,
    [companyId, warehouseId, itemId, qty, cost, referenceType, referenceId, batchNo || null, expiryDate || null, userId],
  );

  await applyStockOnHandDelta(client, {
    companyId, warehouseId, itemId, quantityDelta: -qty, unitCost: cost, userId,
  });
  return cost;
}

async function recordIssueFefo(client, {
  companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId, userId,
}) {
  const plan = await getFefoPickPlan(companyId, warehouseId, itemId, quantity);
  let lastCost = unitCost;
  for (const pick of plan.picks) {
    lastCost = await recordIssue(client, {
      companyId,
      warehouseId,
      itemId,
      quantity: pick.quantity,
      unitCost,
      referenceType,
      referenceId,
      userId,
      useFefo: false,
      batchNo: pick.batch_no,
      expiryDate: pick.expiry_date,
    });
  }
  return lastCost;
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

async function getStockValuation(companyId, { warehouseId } = {}) {
  const params = [companyId];
  let filter = '';
  if (warehouseId) {
    params.push(warehouseId);
    filter = ` AND s.warehouse_id = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT w.code AS warehouse_code, w.name AS warehouse_name,
            COUNT(DISTINCT s.item_id)::int AS sku_count,
            COALESCE(SUM(s.quantity), 0)::numeric AS total_units,
            COALESCE(SUM(s.quantity * s.avg_unit_cost), 0)::numeric AS total_value
     FROM erp_stock_on_hand s
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     WHERE s.company_id = $1 AND s.is_deleted = FALSE ${filter}
     GROUP BY w.id, w.code, w.name
     ORDER BY w.name`,
    params,
  );
  const totals = await pool.query(
    `SELECT COALESCE(SUM(quantity * avg_unit_cost), 0)::numeric AS total_value,
            COALESCE(SUM(quantity), 0)::numeric AS total_units,
            COUNT(DISTINCT item_id)::int AS sku_count
     FROM erp_stock_on_hand
     WHERE company_id = $1 AND is_deleted = FALSE ${filter}`,
    params,
  );
  return {
    by_warehouse: result.rows,
    totals: totals.rows[0],
  };
}

async function getMovementHistory(companyId, { limit = 50, itemId, warehouseId } = {}) {
  const params = [companyId];
  let filter = '';
  if (itemId) {
    params.push(itemId);
    filter += ` AND sl.item_id = $${params.length}`;
  }
  if (warehouseId) {
    params.push(warehouseId);
    filter += ` AND sl.warehouse_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  const result = await pool.query(
    `SELECT sl.*, i.item_code, i.name AS item_name, w.code AS warehouse_code, w.name AS warehouse_name
     FROM erp_stock_ledger sl
     JOIN erp_items i ON i.id = sl.item_id
     JOIN erp_warehouses w ON w.id = sl.warehouse_id
     WHERE sl.company_id = $1 ${filter}
     ORDER BY sl.movement_date DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

module.exports = {
  publishInventoryUpdate,
  afterStockMovement,
  checkLowStockAndPublish,
  getStockOnHand,
  lookupByBarcode,
  getBatchBalances,
  getFefoPickPlan,
  recordReceipt,
  recordIssue,
  recordIssueFefo,
  getReorderAlerts,
  getStockValuation,
  getMovementHistory,
};
