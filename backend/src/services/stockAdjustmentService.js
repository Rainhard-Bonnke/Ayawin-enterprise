const pool = require("../db");
const inventory = require("./inventoryService");
const { logAudit } = require("./auditService");

function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 500) throw new Error("Add between 1 and 500 count lines");
  const seen = new Set();
  return lines.map((line) => {
    const itemId = String(line?.item_id || "");
    const physical = Number(line?.physical_quantity);
    const unitCost = line?.unit_cost == null ? null : Number(line.unit_cost);
    if (!itemId || !Number.isFinite(physical) || physical < 0 || (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0))) {
      throw new Error("Each line needs an item, a non-negative count, and a valid optional cost");
    }
    if (seen.has(itemId)) throw new Error("Use one line per item and warehouse");
    seen.add(itemId);
    const batchNo = String(line?.batch_no || "").trim();
    const expiryDate = String(line?.expiry_date || "").slice(0, 10);
    if (Boolean(batchNo) !== Boolean(expiryDate)) throw new Error("Provide both batch number and expiry date for a counted lot");
    return { itemId, physical, unitCost, batchNo: batchNo || null, expiryDate: expiryDate || null };
  });
}

async function nextAdjustmentNo(client, companyId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`stock-adjustment:${companyId}`]);
  const result = await client.query("SELECT COUNT(*)::int + 1 AS next FROM erp_stock_adjustments WHERE company_id = $1", [companyId]);
  return `ADJ-${new Date().getFullYear()}-${String(result.rows[0].next).padStart(5, "0")}`;
}

async function list(companyId) {
  const result = await pool.query(
    `SELECT a.id, a.adjustment_no, a.adjustment_date, a.reason, a.status, a.created_at, a.posted_at,
       creator.full_name AS created_by_name, reviewer.full_name AS reviewed_by_name,
       w.name AS warehouse_name, COUNT(l.id)::int AS line_count,
       COALESCE(SUM(ABS(l.quantity_delta)),0) AS units_adjusted,
       COALESCE(SUM(ABS(l.quantity_delta) * l.unit_cost),0) AS adjustment_value
     FROM erp_stock_adjustments a JOIN erp_warehouses w ON w.id = a.warehouse_id
     LEFT JOIN erp_users creator ON creator.id = a.created_by
     LEFT JOIN erp_users reviewer ON reviewer.id = a.reviewed_by
     LEFT JOIN erp_stock_adjustment_lines l ON l.adjustment_id = a.id AND l.is_deleted = FALSE
     WHERE a.company_id = $1 AND a.is_deleted = FALSE
     GROUP BY a.id, w.name, creator.full_name, reviewer.full_name
     ORDER BY a.adjustment_date DESC, a.created_at DESC LIMIT 300`, [companyId],
  );
  return result.rows;
}

async function create({ companyId, user, warehouseId, date, reason, lines }) {
  const normalized = normalizeLines(lines);
  if (!String(reason || "").trim()) throw new Error("Adjustment reason is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const warehouse = await client.query("SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE FOR UPDATE", [warehouseId, companyId]);
    if (!warehouse.rowCount) throw new Error("Choose an active warehouse in this company");
    const validItems = await client.query("SELECT id, lot_tracking_enabled FROM erp_items WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_stock_item = TRUE AND is_active = TRUE AND is_deleted = FALSE", [companyId, normalized.map((line) => line.itemId)]);
    if (validItems.rowCount !== normalized.length) throw new Error("Choose active stocked items belonging to this company");
    const adjustmentNo = await nextAdjustmentNo(client, companyId);
    const header = await client.query(
      `INSERT INTO erp_stock_adjustments (company_id, warehouse_id, adjustment_no, adjustment_date, reason, status, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,'draft',$6) RETURNING *`,
      [companyId, warehouseId, adjustmentNo, date || null, String(reason).trim().slice(0, 1000), user.id],
    );
    const itemById = new Map(validItems.rows.map((item) => [item.id, item]));
    for (const [index, line] of normalized.entries()) {
      const stock = await client.query("SELECT quantity, avg_unit_cost FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE", [companyId, warehouseId, line.itemId]);
      const systemQuantity = Number(stock.rows[0]?.quantity || 0);
      const delta = line.physical - systemQuantity;
      if (Math.abs(delta) < 0.0001) continue;
      if (delta > 0 && itemById.get(line.itemId).lot_tracking_enabled && (!line.batchNo || !line.expiryDate)) {
        throw new Error(`Positive count variance for tracked item ${line.itemId} needs a batch number and expiry date`);
      }
      const cost = line.unitCost ?? Number(stock.rows[0]?.avg_unit_cost || 0);
      await client.query(
        `INSERT INTO erp_stock_adjustment_lines
         (company_id, adjustment_id, line_no, item_id, quantity_delta, unit_cost, system_quantity, physical_quantity, batch_no, expiry_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)` ,
        [companyId, header.rows[0].id, index + 1, line.itemId, delta, cost, systemQuantity, line.physical, line.batchNo, line.expiryDate, user.id],
      );
    }
    const count = await client.query("SELECT COUNT(*)::int AS n FROM erp_stock_adjustment_lines WHERE company_id = $1 AND adjustment_id = $2", [companyId, header.rows[0].id]);
    if (!Number(count.rows[0].n)) throw new Error("All counted quantities match the system; no adjustment is needed");
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_stock_adjustments", entityId: header.rows[0].id, action: "stock_adjustment_draft_created", newValues: { adjustment_no: adjustmentNo, line_count: Number(count.rows[0].n), reason } });
    await client.query("COMMIT");
    return header.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function get(companyId, id) {
  const header = await pool.query(
    `SELECT a.*, w.name AS warehouse_name, creator.full_name AS created_by_name, reviewer.full_name AS reviewed_by_name
     FROM erp_stock_adjustments a JOIN erp_warehouses w ON w.id = a.warehouse_id
     LEFT JOIN erp_users creator ON creator.id = a.created_by LEFT JOIN erp_users reviewer ON reviewer.id = a.reviewed_by
     WHERE a.company_id = $1 AND a.id = $2 AND a.is_deleted = FALSE`, [companyId, id],
  );
  if (!header.rowCount) return null;
  const lines = await pool.query(
    `SELECT l.*, i.item_code, i.name AS item_name FROM erp_stock_adjustment_lines l JOIN erp_items i ON i.id = l.item_id
     WHERE l.company_id = $1 AND l.adjustment_id = $2 AND l.is_deleted = FALSE ORDER BY l.line_no`, [companyId, id],
  );
  return { ...header.rows[0], lines: lines.rows };
}

async function post({ companyId, id, user, note }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const headerResult = await client.query("SELECT * FROM erp_stock_adjustments WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE FOR UPDATE", [id, companyId]);
    const header = headerResult.rows[0];
    if (!header) throw new Error("Draft adjustment not found");
    if (header.created_by === user.id) throw new Error("The preparer cannot approve and post their own adjustment");
    const lines = await client.query("SELECT * FROM erp_stock_adjustment_lines WHERE company_id = $1 AND adjustment_id = $2 AND is_deleted = FALSE ORDER BY line_no FOR UPDATE", [companyId, id]);
    for (const line of lines.rows) {
      const current = await client.query("SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE", [companyId, header.warehouse_id, line.item_id]);
      if (Math.abs(Number(current.rows[0]?.quantity || 0) - Number(line.system_quantity)) > 0.0001) {
        throw new Error(`Stock changed for ${line.item_id} after the count. Cancel this draft and recount before posting.`);
      }
    }
    for (const line of lines.rows) {
      const delta = Number(line.quantity_delta);
      if (delta > 0) {
        await inventory.recordReceipt(client, { companyId, warehouseId: header.warehouse_id, itemId: line.item_id, quantity: delta, unitCost: Number(line.unit_cost), batchNo: line.batch_no, expiryDate: line.expiry_date, referenceType: "stock_adjustment", referenceId: id, userId: user.id });
      } else {
        await inventory.recordIssue(client, { companyId, warehouseId: header.warehouse_id, itemId: line.item_id, quantity: Math.abs(delta), unitCost: Number(line.unit_cost), referenceType: "stock_adjustment", referenceId: id, userId: user.id });
      }
    }
    await client.query("UPDATE erp_stock_adjustments SET status = 'posted', posted_at = NOW(), reviewed_by = $3, review_note = $4 WHERE id = $1 AND company_id = $2", [id, companyId, user.id, String(note || "").trim().slice(0, 1000) || null]);
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_stock_adjustments", entityId: id, action: "stock_adjustment_posted", newValues: { adjustment_no: header.adjustment_no, line_count: lines.rowCount, note: note || null } });
    await client.query("COMMIT");
    return get(companyId, id);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function cancel({ companyId, id, user, note }) {
  const result = await pool.query(
    `UPDATE erp_stock_adjustments SET status = 'cancelled', review_note = $4
     WHERE id = $1 AND company_id = $2 AND created_by = $3 AND status = 'draft' AND is_deleted = FALSE RETURNING *`,
    [id, companyId, user.id, String(note || "Cancelled by preparer").trim().slice(0, 1000)],
  );
  if (!result.rowCount) throw new Error("Only the preparer can cancel their own draft adjustment");
  await logAudit({ companyId, userId: user.id, entityType: "erp_stock_adjustments", entityId: id, action: "stock_adjustment_cancelled", newValues: { adjustment_no: result.rows[0].adjustment_no, note: note || null } });
  return result.rows[0];
}

module.exports = { list, get, create, post, cancel };
