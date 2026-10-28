const pool = require("../db");

async function getStockOnHand(companyId, { warehouseId, itemId, q = "", limit = 100 } = {}) {
  const params = [companyId];
  let filter = "";
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
        `SELECT s.*,
          CASE WHEN i.lot_tracking_enabled THEN COALESCE((SELECT SUM(l.quarantined_quantity)
            FROM erp_inventory_lots l WHERE l.company_id = s.company_id AND l.warehouse_id = s.warehouse_id
              AND l.item_id = s.item_id), 0)
            ELSE COALESCE((SELECT q.quantity FROM erp_inventory_quarantine_balances q
              WHERE q.company_id = s.company_id AND q.warehouse_id = s.warehouse_id AND q.item_id = s.item_id), 0)
            END AS quarantined_quantity,
          CASE WHEN i.lot_tracking_enabled THEN COALESCE((SELECT SUM(l.quantity - l.quarantined_quantity)
            FROM erp_inventory_lots l WHERE l.company_id = s.company_id AND l.warehouse_id = s.warehouse_id
              AND l.item_id = s.item_id AND l.quantity > 0 AND l.expiry_date >= CURRENT_DATE), 0)
            ELSE GREATEST(0, s.quantity - COALESCE((SELECT q.quantity FROM erp_inventory_quarantine_balances q
              WHERE q.company_id = s.company_id AND q.warehouse_id = s.warehouse_id AND q.item_id = s.item_id), 0)) END AS sellable_quantity,
          COALESCE((SELECT SUM(r.reserved_quantity - r.fulfilled_quantity - r.released_quantity)
                    FROM erp_sales_order_reservations r
                    WHERE r.company_id = s.company_id AND r.warehouse_id = s.warehouse_id
                      AND r.item_id = s.item_id AND r.status = 'active'), 0) AS reserved_quantity,
          GREATEST(0, (CASE WHEN i.lot_tracking_enabled THEN COALESCE((SELECT SUM(l.quantity - l.quarantined_quantity)
                    FROM erp_inventory_lots l WHERE l.company_id = s.company_id AND l.warehouse_id = s.warehouse_id
                      AND l.item_id = s.item_id AND l.quantity > 0 AND l.expiry_date >= CURRENT_DATE), 0)
                    ELSE s.quantity - COALESCE((SELECT q.quantity FROM erp_inventory_quarantine_balances q
                      WHERE q.company_id = s.company_id AND q.warehouse_id = s.warehouse_id AND q.item_id = s.item_id), 0) END)
                    - COALESCE((SELECT SUM(r.reserved_quantity - r.fulfilled_quantity - r.released_quantity)
                    FROM erp_sales_order_reservations r
                    WHERE r.company_id = s.company_id AND r.warehouse_id = s.warehouse_id
                      AND r.item_id = s.item_id AND r.status = 'active'), 0)) AS available_quantity,
          i.item_code, i.name AS item_name, i.reorder_point,
          ic.name AS category,
            w.code AS warehouse_code, w.name AS warehouse_name,
            (s.quantity * s.avg_unit_cost) AS stock_value
     FROM erp_stock_on_hand s
    JOIN erp_items i ON i.id = s.item_id
    LEFT JOIN erp_item_categories ic ON ic.id = i.category_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     WHERE s.company_id = $1 AND s.is_deleted = FALSE ${filter}
    ORDER BY w.name, i.item_code
    LIMIT $${params.length + 1}`,
    [...params, Math.min(Number(limit) || 100, 1000)],
  );
  return result.rows;
}

async function getSellableQuantity(client, companyId, warehouseId, itemId, untrackedQuantity = 0) {
  const result = await client.query(
    `SELECT CASE WHEN i.lot_tracking_enabled
       THEN COALESCE((SELECT SUM(l.quantity - l.quarantined_quantity)
         FROM erp_inventory_lots l WHERE l.company_id = i.company_id AND l.warehouse_id = $2
           AND l.item_id = i.id AND l.quantity > l.quarantined_quantity AND l.expiry_date >= CURRENT_DATE), 0)
       ELSE GREATEST(0, $4::numeric - COALESCE((SELECT q.quantity FROM erp_inventory_quarantine_balances q
         WHERE q.company_id = i.company_id AND q.warehouse_id = $2 AND q.item_id = i.id), 0)) END AS quantity
     FROM erp_items i WHERE i.id = $1 AND i.company_id = $3 AND i.is_deleted = FALSE`,
    [itemId, warehouseId, companyId, untrackedQuantity],
  );
  return Number(result.rows[0]?.quantity || 0);
}

async function recordReceipt(
  client,
  {
    companyId,
    warehouseId,
    itemId,
    quantity,
    unitCost,
    referenceType,
    referenceId,
    batchNo,
    expiryDate,
    userId,
    movementDate,
    allowExpiredForQuarantine = false,
    sourceType,
    receiptLineId,
    parentLayerId,
  },
) {
  const item = await client.query(
    `SELECT lot_tracking_enabled FROM erp_items
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [itemId, companyId],
  );
  if (!item.rowCount) throw new Error("Item not found in this company");
  if (item.rows[0].lot_tracking_enabled) {
    if (!String(batchNo || "").trim() || !expiryDate) {
      throw new Error("This item requires a batch number and expiry date on every receipt");
    }
    const expiry = String(expiryDate).slice(0, 10);
    const received = String(movementDate || new Date().toISOString()).slice(0, 10);
    if (expiry < received && !allowExpiredForQuarantine) throw new Error("Expired stock cannot be received into available inventory");
  }
  await client.query(
    `INSERT INTO erp_stock_ledger (
       company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
       reference_type, reference_id, batch_no, expiry_date, movement_date, created_by
     ) VALUES ($1,$2,$3,'receipt',$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),$11)`,
    [
      companyId,
      warehouseId,
      itemId,
      quantity,
      unitCost,
      referenceType,
      referenceId,
      batchNo,
      expiryDate,
      movementDate,
      userId,
    ],
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
  } else {
    const row = existing.rows[0];
    const newQty = Number(row.quantity) + Number(quantity);
    const newAvg = newQty > 0
      ? (Number(row.quantity) * Number(row.avg_unit_cost) + Number(quantity) * Number(unitCost)) / newQty
      : unitCost;
    await client.query(
      `UPDATE erp_stock_on_hand
       SET quantity = $4, avg_unit_cost = $5, last_movement_at = NOW(), updated_at = NOW(), updated_by = $6
       WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
      [companyId, warehouseId, itemId, newQty, newAvg, userId],
    );
  }
  if (item.rows[0].lot_tracking_enabled) {
    const lotResult = await client.query(
      `INSERT INTO erp_inventory_lots
       (company_id, warehouse_id, item_id, batch_no, expiry_date, quantity, unit_cost, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (company_id, warehouse_id, item_id, batch_no, expiry_date)
       DO UPDATE SET quantity = erp_inventory_lots.quantity + EXCLUDED.quantity,
                     unit_cost = CASE WHEN erp_inventory_lots.quantity + EXCLUDED.quantity > 0
                       THEN ((erp_inventory_lots.quantity * erp_inventory_lots.unit_cost) + (EXCLUDED.quantity * EXCLUDED.unit_cost))
                            / (erp_inventory_lots.quantity + EXCLUDED.quantity)
                       ELSE EXCLUDED.unit_cost END,
                     updated_by = EXCLUDED.updated_by
       RETURNING id, unit_cost`,
      [companyId, warehouseId, itemId, String(batchNo).trim(), expiryDate, quantity, unitCost, userId],
    );
    let sourceReceiptLineId = receiptLineId || null;
    if (parentLayerId) {
      const parent = await client.query(
        `SELECT source_receipt_line_id FROM erp_inventory_lot_layers
         WHERE id = $1 AND company_id = $2 FOR UPDATE`, [parentLayerId, companyId],
      );
      if (!parent.rowCount) throw new Error("Source inventory layer for this receipt was not found");
      sourceReceiptLineId = parent.rows[0].source_receipt_line_id || null;
    }
    const layer = await client.query(
      `INSERT INTO erp_inventory_lot_layers
       (company_id, lot_id, parent_layer_id, source_receipt_line_id, source_type, source_reference_id,
        received_quantity, quantity_remaining, unit_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) RETURNING id`,
      [companyId, lotResult.rows[0].id, parentLayerId || null, sourceReceiptLineId,
        sourceType || (receiptLineId ? "supplier_receipt" : referenceType === "stock_transfer_receipt" ? "transfer" : referenceType === "material_return" ? "material_return" : "stock_adjustment"),
        referenceId || null, quantity, unitCost, userId],
    );
    return { lotId: lotResult.rows[0].id, layerId: layer.rows[0].id };
  }
  return null;
}

async function recordIssue(
  client,
  { companyId, warehouseId, itemId, quantity, unitCost, referenceType, referenceId, userId, returnAllocations = false },
) {
  const stock = await client.query(
    `SELECT quantity, avg_unit_cost FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
    [companyId, warehouseId, itemId],
  );
  const reservations = stock.rowCount ? await client.query(
    `SELECT COALESCE(SUM(reserved_quantity - fulfilled_quantity - released_quantity), 0) AS quantity
     FROM erp_sales_order_reservations
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND status = 'active'`,
    [companyId, warehouseId, itemId],
  ) : { rows: [{ quantity: 0 }] };
  const item = await client.query(
    `SELECT lot_tracking_enabled FROM erp_items WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [itemId, companyId],
  );
  let allocations = [];
  let lots = { rows: [] };
  if (item.rows[0]?.lot_tracking_enabled) {
    lots = await client.query(
      `SELECT id, batch_no, expiry_date, quantity, unit_cost,
              quantity - quarantined_quantity AS available_quantity
       FROM erp_inventory_lots
       WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3
         AND quantity > quarantined_quantity AND expiry_date >= CURRENT_DATE
       ORDER BY expiry_date, batch_no FOR UPDATE`,
      [companyId, warehouseId, itemId],
    );
  }
  const sellableQuantity = item.rows[0]?.lot_tracking_enabled
    ? lots.rows.reduce((sum, lot) => sum + Number(lot.available_quantity), 0)
    : Math.max(0, Number(stock.rows[0]?.quantity || 0) - Number((await client.query(
      `SELECT COALESCE(quantity,0) AS quantity FROM erp_inventory_quarantine_balances
       WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
      [companyId, warehouseId, itemId],
    )).rows[0]?.quantity || 0));
  const unreserved = sellableQuantity - Number(reservations.rows[0]?.quantity || 0);
  if (!stock.rowCount || unreserved < Number(quantity)) {
    throw new Error(`Insufficient sellable, unreserved stock for item ${itemId}`);
  }
  if (item.rows[0]?.lot_tracking_enabled) {
    let remaining = Number(quantity);
    for (const lot of lots.rows) {
      if (remaining <= 0.00005) break;
      const pickedFromLot = Math.min(remaining, Number(lot.available_quantity));
      const layers = await client.query(
        `SELECT id, source_receipt_line_id, quantity_remaining, quarantined_quantity
         FROM erp_inventory_lot_layers WHERE company_id = $1 AND lot_id = $2
           AND quantity_remaining > quarantined_quantity
         ORDER BY created_at, id FOR UPDATE`, [companyId, lot.id],
      );
      let layerRemaining = pickedFromLot;
      for (const layer of layers.rows) {
        if (layerRemaining <= 0.00005) break;
        const layerPick = Math.min(layerRemaining, Number(layer.quantity_remaining) - Number(layer.quarantined_quantity));
        if (layerPick <= 0) continue;
        const changed = await client.query(
          `UPDATE erp_inventory_lot_layers SET quantity_remaining = quantity_remaining - $2
           WHERE id = $1 AND company_id = $3 AND quantity_remaining - quarantined_quantity >= $2
           RETURNING id`, [layer.id, layerPick, companyId],
        );
        if (!changed.rowCount) throw new Error("Inventory receipt layer changed while issuing stock; retry the movement");
        allocations.push({ ...lot, layer_id: layer.id, source_receipt_line_id: layer.source_receipt_line_id,
          quantity: layerPick, unit_cost: Number(lot.unit_cost) });
        layerRemaining -= layerPick;
        remaining -= layerPick;
      }
      if (layerRemaining > 0.00005) throw new Error(`Receipt layers do not reconcile to the available balance for lot ${lot.id}`);
    }
    if (remaining > 0.00005) {
      throw new Error(`Insufficient unexpired, batch-tracked stock for item ${itemId}; check lot balances and quarantine expired stock`);
    }
  }

  const cost = unitCost ?? stock.rows[0].avg_unit_cost;
  const movements = allocations.length
    ? allocations
    : [{ quantity: Number(quantity), unit_cost: Number(cost), batch_no: null, expiry_date: null }];
  for (const allocation of movements) {
    await client.query(
      `INSERT INTO erp_stock_ledger (
         company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
         reference_type, reference_id, batch_no, expiry_date, created_by
       ) VALUES ($1,$2,$3,'issue',(0 - $4::numeric),$5,$6,$7,$8,$9,$10)`,
      [companyId, warehouseId, itemId, allocation.quantity, allocation.unit_cost, referenceType, referenceId,
        allocation.batch_no, allocation.expiry_date, userId],
    );
    if (allocations.length) {
      const lotUpdate = await client.query(
        `UPDATE erp_inventory_lots SET quantity = quantity - $4, updated_by = $5
         WHERE id = $1 AND company_id = $2 AND warehouse_id = $3 AND quantity - quarantined_quantity >= $4`,
        [allocation.id, companyId, warehouseId, allocation.quantity, userId],
      );
      if (lotUpdate.rowCount !== 1) {
        throw new Error("Inventory lot changed while issuing stock; retry the movement");
      }
    }
  }

  const newQty = Number(stock.rows[0].quantity) - Number(quantity);
  await client.query(
    `UPDATE erp_stock_on_hand SET quantity = $4, last_movement_at = NOW(), updated_at = NOW(), updated_by = $5
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [companyId, warehouseId, itemId, newQty, userId],
  );
  if (returnAllocations) {
    const issuedValue = movements.reduce((sum, movement) => sum + Number(movement.quantity) * Number(movement.unit_cost), 0);
    return {
      unitCost: Number(quantity) > 0 ? issuedValue / Number(quantity) : Number(cost),
      allocations: allocations.map((allocation) => ({
        lotId: allocation.id,
        layerId: allocation.layer_id,
        sourceReceiptLineId: allocation.source_receipt_line_id,
        batchNo: allocation.batch_no,
        expiryDate: String(allocation.expiry_date).slice(0, 10),
        quantity: allocation.quantity,
        unitCost: Number(allocation.unit_cost),
      })),
    };
  }
  if (allocations.length) {
    const issuedValue = allocations.reduce((sum, allocation) => sum + Number(allocation.quantity) * Number(allocation.unit_cost), 0);
    return Number(quantity) > 0 ? issuedValue / Number(quantity) : Number(cost);
  }
  return cost;
}

async function adjustLotLayerQuarantine(client, { companyId, lotId, quantity, action }) {
  const releasing = action === "release";
  const layers = await client.query(
    `SELECT id, source_receipt_line_id, quantity_remaining, quarantined_quantity
     FROM erp_inventory_lot_layers WHERE company_id = $1 AND lot_id = $2
       AND ${releasing ? "quarantined_quantity > 0" : "quantity_remaining > quarantined_quantity"}
     ORDER BY created_at, id FOR UPDATE`, [companyId, lotId],
  );
  let remaining = Number(quantity);
  const allocations = [];
  for (const layer of layers.rows) {
    if (remaining <= 0.00005) break;
    const available = releasing ? Number(layer.quarantined_quantity)
      : Number(layer.quantity_remaining) - Number(layer.quarantined_quantity);
    const moved = Math.min(remaining, available);
    if (moved <= 0) continue;
    const updated = await client.query(
      `UPDATE erp_inventory_lot_layers SET quarantined_quantity = quarantined_quantity ${releasing ? "-" : "+"} $2
       WHERE id = $1 AND company_id = $3 RETURNING id`, [layer.id, moved, companyId],
    );
    if (!updated.rowCount) throw new Error("Inventory receipt layer changed while updating quarantine status");
    allocations.push({ layerId: layer.id, sourceReceiptLineId: layer.source_receipt_line_id, quantity: moved });
    remaining -= moved;
  }
  if (remaining > 0.00005) throw new Error("Quarantined quantity does not reconcile to its tracked receipt layers");
  return allocations;
}

async function consumeQuarantinedLotLayers(client, { companyId, lotId, quantity }) {
  const layers = await client.query(
    `SELECT id, source_receipt_line_id, quantity_remaining, quarantined_quantity
     FROM erp_inventory_lot_layers WHERE company_id = $1 AND lot_id = $2 AND quarantined_quantity > 0
     ORDER BY created_at, id FOR UPDATE`, [companyId, lotId],
  );
  let remaining = Number(quantity);
  const allocations = [];
  for (const layer of layers.rows) {
    if (remaining <= 0.00005) break;
    const removed = Math.min(remaining, Number(layer.quarantined_quantity));
    const updated = await client.query(
      `UPDATE erp_inventory_lot_layers
       SET quantity_remaining = quantity_remaining - $2, quarantined_quantity = quarantined_quantity - $2
       WHERE id = $1 AND company_id = $3 AND quantity_remaining >= $2 AND quarantined_quantity >= $2
       RETURNING id`, [layer.id, removed, companyId],
    );
    if (!updated.rowCount) throw new Error("Quarantined receipt layer changed before disposition posting");
    allocations.push({ layerId: layer.id, sourceReceiptLineId: layer.source_receipt_line_id, quantity: removed });
    remaining -= removed;
  }
  if (remaining > 0.00005) throw new Error("Quarantined quantity does not reconcile to its tracked receipt layers");
  return allocations;
}

async function getLotBalances(companyId, { warehouseId, itemId, includeExpired = true } = {}) {
  const params = [companyId];
  let filter = "";
  if (warehouseId) { params.push(warehouseId); filter += ` AND l.warehouse_id = $${params.length}`; }
  if (itemId) { params.push(itemId); filter += ` AND l.item_id = $${params.length}`; }
  if (!includeExpired) filter += " AND l.expiry_date >= CURRENT_DATE";
  const result = await pool.query(
    `SELECT l.*, i.item_code, i.name AS item_name, w.code AS warehouse_code, w.name AS warehouse_name,
            (l.expiry_date - CURRENT_DATE)::int AS days_to_expiry,
            CASE WHEN l.expiry_date >= CURRENT_DATE THEN l.quantity - l.quarantined_quantity ELSE 0 END AS available_quantity
     FROM erp_inventory_lots l JOIN erp_items i ON i.id = l.item_id AND i.company_id = l.company_id
     JOIN erp_warehouses w ON w.id = l.warehouse_id AND w.company_id = l.company_id
     WHERE l.company_id = $1 AND l.quantity > 0 ${filter}
     ORDER BY l.expiry_date, w.name, i.item_code`, params,
  );
  return result.rows;
}

async function getReorderAlerts(companyId, limit = 100) {
  const result = await pool.query(
    `SELECT s.*, i.item_code, i.name AS item_name, i.reorder_point, w.name AS warehouse_name
     FROM erp_stock_on_hand s
     JOIN erp_items i ON i.id = s.item_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     WHERE s.company_id = $1 AND i.reorder_point > 0 AND s.quantity <= i.reorder_point
    ORDER BY s.quantity ASC
    LIMIT $2`,
    [companyId, Math.min(Number(limit) || 100, 200)],
  );
  return result.rows;
}

module.exports = { getStockOnHand, getLotBalances, getSellableQuantity, recordReceipt, recordIssue,
  adjustLotLayerQuarantine, consumeQuarantinedLotLayers, getReorderAlerts };
