const pool = require("../db");
const inventory = require("./inventoryService");
const { logAudit } = require("./auditService");

async function listTransfers(companyId, limit = 100) {
  const result = await pool.query(
    `SELECT t.*, fw.code AS from_warehouse_code, fw.name AS from_warehouse_name,
            tw.code AS to_warehouse_code, tw.name AS to_warehouse_name,
            COALESCE(SUM(l.quantity), 0) AS quantity,
            COALESCE(SUM(l.received_quantity), 0) AS received_quantity,
            COALESCE(SUM(l.damaged_quantity), 0) AS damaged_quantity,
            COALESCE(SUM(l.short_quantity), 0) AS short_quantity,
            COALESCE(SUM(GREATEST(0, l.quantity - l.received_quantity - l.damaged_quantity - l.short_quantity)), 0) AS in_transit_quantity,
            COUNT(l.id)::int AS line_count,
            COUNT(l.id) FILTER (WHERE l.receipt_complete)::int AS completed_line_count
     FROM erp_stock_transfers t
     JOIN erp_warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
     JOIN erp_warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
     LEFT JOIN erp_stock_transfer_lines l ON l.transfer_id = t.id AND l.is_deleted = FALSE
     WHERE t.company_id = $1 AND t.is_deleted = FALSE
     GROUP BY t.id, fw.code, fw.name, tw.code, tw.name
     ORDER BY t.created_at DESC LIMIT $2`,
    [companyId, Math.min(Math.max(Number(limit) || 100, 1), 300)],
  );
  return result.rows;
}

async function getTransfer(companyId, transferId) {
  const result = await pool.query(
    `SELECT t.*, fw.code AS from_warehouse_code, fw.name AS from_warehouse_name,
            tw.code AS to_warehouse_code, tw.name AS to_warehouse_name
     FROM erp_stock_transfers t
     JOIN erp_warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
     JOIN erp_warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
     WHERE t.id = $1 AND t.company_id = $2 AND t.is_deleted = FALSE`,
    [transferId, companyId],
  );
  if (!result.rowCount) return null;
  const lines = await pool.query(
    `SELECT l.*, i.item_code, i.name AS item_name, i.uom_id,
            u.code AS uom_code
     FROM erp_stock_transfer_lines l
     JOIN erp_items i ON i.id = l.item_id AND i.company_id = l.company_id
     LEFT JOIN erp_uom u ON u.id = i.uom_id
     WHERE l.transfer_id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE
     ORDER BY l.line_no`,
    [transferId, companyId],
  );
  return { ...result.rows[0], lines: lines.rows };
}

async function dispatchTransfer({ companyId, fromWarehouseId, toWarehouseId, lines, notes, user }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Add at least one stock item to transfer");
  if (String(fromWarehouseId) === String(toWarehouseId)) throw new Error("Choose different source and destination locations");
  const grouped = new Map();
  for (const line of lines) {
    const itemId = String(line.item_id || "");
    const quantity = Number(line.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Each transfer line needs an item and positive quantity");
    grouped.set(itemId, (grouped.get(itemId) || 0) + quantity);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`transfer:${companyId}`]);
    const locationRows = await client.query(
      `SELECT id FROM erp_warehouses WHERE company_id = $1 AND id = ANY($2::uuid[])
       AND is_active = TRUE AND is_deleted = FALSE ORDER BY id FOR UPDATE`,
      [companyId, [fromWarehouseId, toWarehouseId]],
    );
    if (locationRows.rowCount !== 2) throw new Error("Both transfer locations must be active and in your company");
    const itemIds = [...grouped.keys()].sort();
    const validItems = await client.query(
      `SELECT id FROM erp_items WHERE company_id = $1 AND id = ANY($2::uuid[])
       AND is_active = TRUE AND is_deleted = FALSE AND is_stock_item = TRUE`,
      [companyId, itemIds],
    );
    if (validItems.rowCount !== itemIds.length) throw new Error("Every item must be an active stock item in your company");
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM erp_stock_transfers
       WHERE company_id = $1 AND transfer_no LIKE $2`,
      [companyId, `ST-${new Date().getFullYear()}-%`],
    );
    const transferNo = `ST-${new Date().getFullYear()}-${String(Number(count.rows[0].n) + 1).padStart(5, "0")}`;
    const transferResult = await client.query(
      `INSERT INTO erp_stock_transfers
       (company_id, transfer_no, from_warehouse_id, to_warehouse_id, status, notes, dispatched_at, dispatched_by, posted_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'in_transit',$5,NOW(),$6,NOW(),$6,$6) RETURNING *`,
      [companyId, transferNo, fromWarehouseId, toWarehouseId, String(notes || "").trim().slice(0, 1000) || null, user.id],
    );
    const transfer = transferResult.rows[0];
    let lineNo = 1;
    for (const itemId of itemIds) {
      const issued = await inventory.recordIssue(client, {
        companyId, warehouseId: fromWarehouseId, itemId, quantity: grouped.get(itemId),
        referenceType: "stock_transfer", referenceId: transfer.id, userId: user.id, returnAllocations: true,
      });
      const allocations = issued.allocations.length
        ? issued.allocations
        : [{ quantity: grouped.get(itemId), unitCost: issued.unitCost, batchNo: null, expiryDate: null }];
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO erp_stock_transfer_lines
          (company_id, transfer_id, line_no, item_id, quantity, batch_no, expiry_date, unit_cost, source_layer_id, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [companyId, transfer.id, lineNo++, itemId, allocation.quantity, allocation.batchNo, allocation.expiryDate, allocation.unitCost, allocation.layerId || null, user.id],
        );
      }
    }
    await logAudit({
      client, companyId, userId: user.id, entityType: "erp_stock_transfers", entityId: transfer.id,
      action: "inventory_transfer_dispatched",
      newValues: { transfer_no: transferNo, from_warehouse_id: fromWarehouseId, to_warehouse_id: toWarehouseId, line_count: lineNo - 1, status: "in_transit" },
    });
    await client.query("COMMIT");
    return { ok: true, id: transfer.id, transfer_no: transferNo, status: "in_transit" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function receiveTransfer({ companyId, transferId, lines, notes, user }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Enter receipt quantities for at least one transfer line");
  const seen = new Set();
  for (const line of lines) {
    const id = String(line.transfer_line_id || "");
    const received = Number(line.received_quantity);
    const damaged = Number(line.damaged_quantity || 0);
    if (!id || seen.has(id) || !Number.isFinite(received) || received < 0 || !Number.isFinite(damaged) || damaged < 0 || damaged > received || typeof line.complete !== "boolean") {
      throw new Error("Receipt lines must have unique IDs, non-negative quantities, and damaged quantity no greater than received");
    }
    seen.add(id);
  }
  if (lines.some((line) => Number(line.damaged_quantity) > 0) && !String(notes || "").trim()) throw new Error("Add a note explaining damaged quantities");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transferResult = await client.query(
      `SELECT * FROM erp_stock_transfers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [transferId, companyId],
    );
    if (!transferResult.rowCount) throw new Error("Transfer not found");
    const transfer = transferResult.rows[0];
    if (!["in_transit", "partially_received"].includes(transfer.status)) throw new Error("This transfer is not awaiting receipt");
    if (String(transfer.dispatched_by) === String(user.id)) throw new Error("The dispatcher cannot confirm the destination receipt");

    const lineIds = [...seen].sort();
    const transferLines = await client.query(
      `SELECT l.*, i.lot_tracking_enabled FROM erp_stock_transfer_lines l
       JOIN erp_items i ON i.id = l.item_id AND i.company_id = l.company_id
       WHERE l.transfer_id = $1 AND l.company_id = $2 AND l.id = ANY($3::uuid[]) AND l.is_deleted = FALSE
       ORDER BY l.id FOR UPDATE OF l`,
      [transferId, companyId, lineIds],
    );
    if (transferLines.rowCount !== lineIds.length) throw new Error("One or more transfer lines do not belong to this transfer");
    const requested = new Map(lines.map((line) => [String(line.transfer_line_id), line]));
    const receiptSummary = [];
    for (const transferLine of transferLines.rows) {
      if (transferLine.receipt_complete) throw new Error("A transfer line has already been fully received");
      const input = requested.get(transferLine.id);
      const physicalReceived = Number(input.received_quantity);
      const accepted = physicalReceived - Number(input.damaged_quantity || 0);
      const damage = Number(input.damaged_quantity || 0);
      const expiryCheck = transferLine.lot_tracking_enabled && transferLine.expiry_date
        ? await client.query("SELECT $1::date < CURRENT_DATE AS expired", [transferLine.expiry_date])
        : { rows: [{ expired: false }] };
      const expiredAtReceipt = Boolean(expiryCheck.rows[0].expired);
      const remaining = Number(transferLine.quantity) - Number(transferLine.received_quantity) - Number(transferLine.damaged_quantity) - Number(transferLine.short_quantity);
      if (Number(input.received_quantity) > remaining + 0.00005) throw new Error(`Receipt exceeds the quantity still in transit for ${transferLine.item_id}`);
      if (input.complete && physicalReceived < remaining - 0.00005 && !String(notes || "").trim()) {
        throw new Error("Add a note explaining the shortage before closing the transfer line");
      }
      if (expiredAtReceipt && accepted > 0) throw new Error("This transferred batch expired in transit; receive it as damaged/quarantined stock");
      if (physicalReceived > 0) {
        const receivedLayer = await inventory.recordReceipt(client, {
          companyId, warehouseId: transfer.to_warehouse_id, itemId: transferLine.item_id,
          quantity: physicalReceived, unitCost: transferLine.unit_cost, referenceType: "stock_transfer_receipt",
          referenceId: transfer.id, batchNo: transferLine.batch_no, expiryDate: transferLine.expiry_date,
          userId: user.id, allowExpiredForQuarantine: expiredAtReceipt && accepted === 0,
          sourceType: "transfer", parentLayerId: transferLine.source_layer_id,
        });
        if (damage > 0 && receivedLayer?.layerId) {
          const quarantinedLayer = await client.query(
            `UPDATE erp_inventory_lot_layers SET quarantined_quantity = quarantined_quantity + $2
             WHERE id = $1 AND quantity_remaining - quarantined_quantity >= $2 RETURNING id`,
            [receivedLayer.layerId, damage],
          );
          if (!quarantinedLayer.rowCount) throw new Error("Damaged transfer quantity does not reconcile to the received inventory layer");
        }
      }
      if (damage > 0) {
        const reason = String(notes || "Damage reported at transfer receipt").trim().slice(0, 1000);
        if (transferLine.lot_tracking_enabled) {
          const lot = await client.query(
            `UPDATE erp_inventory_lots SET quarantined_quantity = quarantined_quantity + $5, updated_by = $6
             WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND batch_no = $4
               AND expiry_date = $7 AND quantity - quarantined_quantity >= $5
             RETURNING id, quarantined_quantity`,
            [companyId, transfer.to_warehouse_id, transferLine.item_id, transferLine.batch_no, damage, user.id, transferLine.expiry_date],
          );
          if (lot.rowCount !== 1) throw new Error("Unable to quarantine damaged quantity in the received batch");
          await client.query(
            `INSERT INTO erp_inventory_lot_events (company_id, warehouse_id, item_id, lot_id, event_type, quantity, reason, created_by)
             VALUES ($1,$2,$3,$4,'quarantined',$5,$6,$7)`,
            [companyId, transfer.to_warehouse_id, transferLine.item_id, lot.rows[0].id, damage, reason, user.id],
          );
        } else {
          await client.query(
            `INSERT INTO erp_inventory_quarantine_balances (company_id, warehouse_id, item_id, quantity, updated_by)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id, warehouse_id, item_id)
             DO UPDATE SET quantity = erp_inventory_quarantine_balances.quantity + EXCLUDED.quantity,
               updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
            [companyId, transfer.to_warehouse_id, transferLine.item_id, damage, user.id],
          );
          await client.query(
            `INSERT INTO erp_inventory_quarantine_events
             (company_id, warehouse_id, item_id, source_type, source_id, event_type, quantity, reason, created_by)
             VALUES ($1,$2,$3,'stock_transfer',$4,'quarantined',$5,$6,$7)`,
            [companyId, transfer.to_warehouse_id, transferLine.item_id, transfer.id, damage, reason, user.id],
          );
        }
      }
      const cumulativeGood = Number(transferLine.received_quantity) + accepted;
      const cumulativeDamaged = Number(transferLine.damaged_quantity) + damage;
      const closeLine = Boolean(input.complete);
      const short = closeLine ? Math.max(0, Number(transferLine.quantity) - cumulativeGood - cumulativeDamaged) : 0;
      await client.query(
        `UPDATE erp_stock_transfer_lines SET received_quantity = $3, damaged_quantity = $4,
           short_quantity = $5, receipt_complete = $6, updated_at = NOW(), updated_by = $7
         WHERE id = $1 AND transfer_id = $2`,
        [transferLine.id, transfer.id, cumulativeGood, cumulativeDamaged, short, closeLine, user.id],
      );
      receiptSummary.push({ line_id: transferLine.id, accepted_quantity: accepted, damaged_quantity: damage, short_quantity: short, complete: closeLine });
    }
    const state = await client.query(
      `SELECT COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE receipt_complete)::int AS complete_lines,
              COALESCE(SUM(received_quantity),0) AS received,
              COALESCE(SUM(damaged_quantity + short_quantity),0) AS variance
       FROM erp_stock_transfer_lines WHERE transfer_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [transfer.id, companyId],
    );
    const allComplete = Number(state.rows[0].lines) > 0 && Number(state.rows[0].complete_lines) === Number(state.rows[0].lines);
    const anyReceived = Number(state.rows[0].received) > 0 || Number(state.rows[0].variance) > 0;
    const status = allComplete
      ? Number(state.rows[0].variance) > 0 ? "received_with_variance" : "received"
      : anyReceived ? "partially_received" : "in_transit";
    await client.query(
      `UPDATE erp_stock_transfers SET status = $2,
         received_at = CASE WHEN $3 THEN NOW() ELSE received_at END,
         received_by = CASE WHEN $3 THEN $4 ELSE received_by END,
         receipt_notes = CASE WHEN NULLIF($5, '') IS NULL THEN receipt_notes
           ELSE CONCAT_WS(E'\\n', NULLIF(receipt_notes, ''), $5) END,
         updated_at = NOW(), updated_by = $4
       WHERE id = $1`,
      [transfer.id, status, allComplete, user.id, String(notes || "").trim().slice(0, 1000)],
    );
    await logAudit({
      client, companyId, userId: user.id, entityType: "erp_stock_transfers", entityId: transfer.id,
      action: allComplete ? "inventory_transfer_received" : "inventory_transfer_receipt_progress",
      oldValues: { status: transfer.status },
      newValues: { status, receipt_lines: receiptSummary, notes: String(notes || "").trim() || null },
    });
    await client.query("COMMIT");
    return { ok: true, id: transfer.id, transfer_no: transfer.transfer_no, status, receipt_lines: receiptSummary };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

module.exports = { listTransfers, getTransfer, dispatchTransfer, receiveTransfer };
