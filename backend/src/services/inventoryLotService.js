const pool = require("../db");
const { logAudit } = require("./auditService");
const inventory = require("./inventoryService");

async function changeQuarantine({ companyId, lotId, user, action, quantity, reason }) {
  const amount = Number(quantity);
  const note = String(reason || "").trim().slice(0, 1000);
  if (!Number.isFinite(amount) || amount <= 0 || !note) throw new Error("Enter a positive quantity and reason");
  if (!["quarantine", "release"].includes(action)) throw new Error("Unsupported lot action");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT l.company_id, l.warehouse_id, l.item_id
       FROM erp_inventory_lots l WHERE l.id = $1 AND l.company_id = $2`, [lotId, companyId],
    );
    if (!result.rowCount) throw new Error("Tracked inventory lot not found");
    const identity = result.rows[0];
    const stockLock = await client.query(
      `SELECT id FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE`,
      [companyId, identity.warehouse_id, identity.item_id],
    );
    if (!stockLock.rowCount) throw new Error("Lot has no matching stock balance; reconcile inventory before changing its status");
    const locked = await client.query(
      `SELECT l.*, i.lot_tracking_enabled, l.expiry_date < CURRENT_DATE AS is_expired
       FROM erp_inventory_lots l JOIN erp_items i ON i.id = l.item_id AND i.company_id = l.company_id
       WHERE l.id = $1 AND l.company_id = $2 FOR UPDATE OF l`,
      [lotId, companyId],
    );
    const lot = locked.rows[0];
    if (!lot || !lot.lot_tracking_enabled) throw new Error("Tracked inventory lot not found");
    let nextQuarantined;
    let eventType;
    if (action === "quarantine") {
      const available = Number(lot.quantity) - Number(lot.quarantined_quantity);
      if (amount > available) throw new Error(`Only ${available} units in this batch are available to quarantine`);
      const reserved = await client.query(
        `SELECT COALESCE(SUM(reserved_quantity - fulfilled_quantity - released_quantity), 0) AS quantity
         FROM erp_sales_order_reservations WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND status = 'active'`,
        [companyId, lot.warehouse_id, lot.item_id],
      );
      const allSellable = await client.query(
        `SELECT COALESCE(SUM(quantity - quarantined_quantity),0) AS quantity
         FROM erp_inventory_lots WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND expiry_date >= CURRENT_DATE`,
        [companyId, lot.warehouse_id, lot.item_id],
      );
      const reductionToSellable = lot.is_expired ? 0 : amount;
      if (Number(allSellable.rows[0].quantity) - reductionToSellable < Number(reserved.rows[0].quantity)) {
        throw new Error("Quarantine would make confirmed customer reservations exceed sellable stock; resolve those orders first");
      }
      nextQuarantined = Number(lot.quarantined_quantity) + amount;
      eventType = "quarantined";
    } else {
      if (lot.is_expired) {
        throw new Error("Expired stock cannot be released to sellable inventory");
      }
      if (amount > Number(lot.quarantined_quantity)) throw new Error(`Only ${Number(lot.quarantined_quantity)} units in this batch are quarantined`);
      nextQuarantined = Number(lot.quarantined_quantity) - amount;
      eventType = "released";
    }
    const layerAllocations = await inventory.adjustLotLayerQuarantine(client, {
      companyId, lotId: lot.id, quantity: amount, action,
    });
    await client.query(
      "UPDATE erp_inventory_lots SET quarantined_quantity = $2, updated_by = $3 WHERE id = $1 AND company_id = $4",
      [lot.id, nextQuarantined, user.id, companyId],
    );
    const event = await client.query(
      `INSERT INTO erp_inventory_lot_events (company_id, warehouse_id, item_id, lot_id, event_type, quantity, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [companyId, lot.warehouse_id, lot.item_id, lot.id, eventType, amount, note, user.id],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_inventory_lots", entityId: lot.id,
      action: `inventory_lot_${eventType}`, newValues: { batch_no: lot.batch_no, expiry_date: String(lot.expiry_date).slice(0, 10), quantity: amount, quarantined_quantity: nextQuarantined, layer_allocations: layerAllocations, reason: note } });
    await client.query("COMMIT");
    return { ...event.rows[0], available_quantity: Number(lot.quantity) - nextQuarantined, quarantined_quantity: nextQuarantined };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function listEvents(companyId, lotId) {
  const result = await pool.query(
    `SELECT e.*, u.full_name AS created_by_name
     FROM erp_inventory_lot_events e LEFT JOIN erp_users u ON u.id = e.created_by
     WHERE e.company_id = $1 AND e.lot_id = $2 ORDER BY e.created_at DESC LIMIT 100`, [companyId, lotId],
  );
  return result.rows;
}

module.exports = { changeQuarantine, listEvents };
