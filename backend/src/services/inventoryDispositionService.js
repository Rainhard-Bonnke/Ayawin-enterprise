const pool = require("../db");
const gl = require("./glPostingService");
const { ACCOUNT_CODES } = require("./accountCodes");
const { logAudit } = require("./auditService");
const inventory = require("./inventoryService");

async function listQuarantined(companyId) {
  const result = await pool.query(
    `SELECT l.id::text AS source_id, 'lot'::text AS source_type, l.id AS lot_id, l.company_id,
            l.warehouse_id, l.item_id, l.batch_no, l.expiry_date,
            l.quarantined_quantity AS quantity, l.unit_cost,
            i.item_code, i.name AS item_name, w.code AS warehouse_code, w.name AS warehouse_name
     FROM erp_inventory_lots l
     JOIN erp_items i ON i.id = l.item_id AND i.company_id = l.company_id
     JOIN erp_warehouses w ON w.id = l.warehouse_id AND w.company_id = l.company_id
     WHERE l.company_id = $1 AND l.quarantined_quantity > 0 AND i.lot_tracking_enabled
     UNION ALL
     SELECT q.company_id::text || ':' || q.warehouse_id::text || ':' || q.item_id::text AS source_id,
            'item'::text AS source_type, NULL::uuid AS lot_id, q.company_id, q.warehouse_id, q.item_id,
            NULL::text AS batch_no, NULL::date AS expiry_date, q.quantity, s.avg_unit_cost AS unit_cost,
            i.item_code, i.name AS item_name, w.code AS warehouse_code, w.name AS warehouse_name
     FROM erp_inventory_quarantine_balances q
     JOIN erp_items i ON i.id = q.item_id AND i.company_id = q.company_id AND NOT i.lot_tracking_enabled
     JOIN erp_warehouses w ON w.id = q.warehouse_id AND w.company_id = q.company_id
     JOIN erp_stock_on_hand s ON s.company_id = q.company_id AND s.warehouse_id = q.warehouse_id AND s.item_id = q.item_id
     WHERE q.company_id = $1 AND q.quantity > 0
     ORDER BY warehouse_name, item_code, expiry_date NULLS LAST`,
    [companyId],
  );
  return result.rows;
}

async function getDispositionSetup(companyId) {
  const [vendors, accounts] = await Promise.all([
    pool.query("SELECT id, vendor_code, name FROM erp_vendors WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE ORDER BY name", [companyId]),
    pool.query(`SELECT id, account_code, account_name, account_type FROM erp_chart_of_accounts
      WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE
        AND account_code <> $2 AND account_type IN ('asset','expense') ORDER BY account_code`, [companyId, ACCOUNT_CODES.inventory]),
  ]);
  return { vendors: vendors.rows, accounts: accounts.rows };
}

async function listDispositions(companyId) {
  const result = await pool.query(
    `SELECT d.*, v.name AS vendor_name, a.account_code AS offset_account_code,
            a.account_name AS offset_account_name, j.journal_no,
            creator.full_name AS created_by_name, poster.full_name AS posted_by_name,
            w.name AS warehouse_name, i.item_code, i.name AS item_name, l.batch_no,
            dl.quantity, dl.unit_cost, (dl.quantity * dl.unit_cost) AS value
     FROM erp_inventory_dispositions d
     JOIN erp_inventory_disposition_lines dl ON dl.disposition_id = d.id AND dl.company_id = d.company_id
     JOIN erp_warehouses w ON w.id = dl.warehouse_id AND w.company_id = dl.company_id
     JOIN erp_items i ON i.id = dl.item_id AND i.company_id = dl.company_id
     LEFT JOIN erp_inventory_lots l ON l.id = dl.lot_id AND l.company_id = dl.company_id
     LEFT JOIN erp_vendors v ON v.id = d.vendor_id AND v.company_id = d.company_id
     LEFT JOIN erp_chart_of_accounts a ON a.id = d.offset_account_id AND a.company_id = d.company_id
     LEFT JOIN erp_journals j ON j.id = d.journal_id AND j.company_id = d.company_id
     LEFT JOIN erp_users creator ON creator.id = d.created_by
     LEFT JOIN erp_users poster ON poster.id = d.posted_by
     WHERE d.company_id = $1 AND d.is_deleted = FALSE
     ORDER BY d.created_at DESC LIMIT 300`,
    [companyId],
  );
  return result.rows;
}

async function createDisposition({ companyId, user, dispositionType, warehouseId, itemId, lotId, quantity, reason, vendorId, referenceNo, offsetAccountId }) {
  const amount = Number(quantity);
  const note = String(reason || "").trim().slice(0, 1000);
  if (!["release", "write_off", "supplier_return"].includes(dispositionType)) throw new Error("Choose release, write-off, or supplier return");
  if (!warehouseId || !itemId || !Number.isFinite(amount) || amount <= 0 || !note) throw new Error("Choose a location and item, enter a positive quantity, and give a reason");
  if (dispositionType === "supplier_return" && !vendorId) throw new Error("Choose the supplier for a supplier return");
  if (dispositionType !== "supplier_return" && vendorId) throw new Error("A supplier is only required for a supplier return");
  if (dispositionType !== "release" && !offsetAccountId) throw new Error("Choose the finance account to offset this inventory disposition");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`inventory-disposition:${companyId}`]);
    const warehouse = await client.query("SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE", [warehouseId, companyId]);
    const item = await client.query("SELECT id, lot_tracking_enabled FROM erp_items WHERE id = $1 AND company_id = $2 AND is_stock_item = TRUE AND is_active = TRUE AND is_deleted = FALSE", [itemId, companyId]);
    if (!warehouse.rowCount || !item.rowCount) throw new Error("Choose an active warehouse and stock item in this company");
    if (Boolean(item.rows[0].lot_tracking_enabled) !== Boolean(lotId)) throw new Error(item.rows[0].lot_tracking_enabled ? "Choose a specific tracked lot" : "This item uses a warehouse quarantine balance, not a lot");

    const stock = await client.query("SELECT quantity, avg_unit_cost FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE", [companyId, warehouseId, itemId]);
    if (!stock.rowCount) throw new Error("Quarantined stock has no matching on-hand balance");
    let unitCost = Number(stock.rows[0].avg_unit_cost || 0);
    let quarantined = 0;
    let expired = false;
    if (lotId) {
      const lot = await client.query("SELECT quantity, quarantined_quantity, unit_cost, expiry_date < CURRENT_DATE AS expired FROM erp_inventory_lots WHERE id = $1 AND company_id = $2 AND warehouse_id = $3 AND item_id = $4 FOR UPDATE", [lotId, companyId, warehouseId, itemId]);
      if (!lot.rowCount) throw new Error("Tracked lot not found at the selected warehouse");
      unitCost = Number(lot.rows[0].unit_cost || 0);
      quarantined = Number(lot.rows[0].quarantined_quantity);
      expired = lot.rows[0].expired;
    } else {
      const balance = await client.query("SELECT quantity FROM erp_inventory_quarantine_balances WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE", [companyId, warehouseId, itemId]);
      quarantined = Number(balance.rows[0]?.quantity || 0);
    }
    if (amount > quarantined) throw new Error(`Only ${quarantined} quarantined units are available for disposition`);
    if (dispositionType === "release" && expired) throw new Error("Expired stock cannot be released to sellable inventory");
    if (dispositionType === "supplier_return") {
      const vendor = await client.query("SELECT id FROM erp_vendors WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE", [vendorId, companyId]);
      if (!vendor.rowCount) throw new Error("Choose an active supplier in this company");
    }
    if (dispositionType !== "release") {
      const accountType = dispositionType === "write_off" ? "expense" : "asset";
      const account = await client.query("SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = $3 AND is_active = TRUE AND is_postable = TRUE AND is_deleted = FALSE AND account_code <> $4", [offsetAccountId, companyId, accountType, ACCOUNT_CODES.inventory]);
      if (!account.rowCount) throw new Error(`Choose an active, postable ${accountType} account from this company`);
    }

    const sequence = await client.query("SELECT COUNT(*)::int + 1 AS n FROM erp_inventory_dispositions WHERE company_id = $1 AND disposition_no LIKE $2", [companyId, `QD-${new Date().getFullYear()}-%`]);
    const dispositionNo = `QD-${new Date().getFullYear()}-${String(sequence.rows[0].n).padStart(5, "0")}`;
    const header = await client.query(
      `INSERT INTO erp_inventory_dispositions (company_id, disposition_no, disposition_type, reason, vendor_id, reference_no, offset_account_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [companyId, dispositionNo, dispositionType, note, vendorId || null, String(referenceNo || "").trim().slice(0, 100) || null, offsetAccountId || null, user.id],
    );
    await client.query(
      `INSERT INTO erp_inventory_disposition_lines (company_id, disposition_id, warehouse_id, item_id, lot_id, quantity, unit_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [companyId, header.rows[0].id, warehouseId, itemId, lotId || null, amount, unitCost, user.id],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_inventory_dispositions", entityId: header.rows[0].id,
      action: "inventory_disposition_draft_created", newValues: { disposition_no: dispositionNo, disposition_type: dispositionType, warehouse_id: warehouseId, item_id: itemId, lot_id: lotId || null, quantity: amount, unit_cost: unitCost, reason: note } });
    await client.query("COMMIT");
    return { ...header.rows[0], quantity: amount, unit_cost: unitCost, value: amount * unitCost };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function postDisposition({ companyId, id, user }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`inventory-disposition:${companyId}`]);
    const headerResult = await client.query("SELECT * FROM erp_inventory_dispositions WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE FOR UPDATE", [id, companyId]);
    const header = headerResult.rows[0];
    if (!header) throw new Error("Disposition draft not found");
    if (String(header.created_by) === String(user.id)) throw new Error("The preparer cannot approve their own disposition");
    const lineResult = await client.query("SELECT * FROM erp_inventory_disposition_lines WHERE disposition_id = $1 AND company_id = $2 FOR UPDATE", [id, companyId]);
    const line = lineResult.rows[0];
    if (!line) throw new Error("Disposition line not found");
    const stock = await client.query("SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE", [companyId, line.warehouse_id, line.item_id]);
    if (!stock.rowCount || Number(stock.rows[0].quantity) < Number(line.quantity)) throw new Error("Physical stock no longer covers the quarantined disposition");

    let eventType = header.disposition_type === "release" ? "released" : header.disposition_type === "write_off" ? "written_off" : "supplier_returned";
    if (line.lot_id) {
      const lot = await client.query("SELECT quantity, quarantined_quantity, expiry_date < CURRENT_DATE AS expired FROM erp_inventory_lots WHERE id = $1 AND company_id = $2 AND warehouse_id = $3 AND item_id = $4 FOR UPDATE", [line.lot_id, companyId, line.warehouse_id, line.item_id]);
      if (!lot.rowCount || Number(lot.rows[0].quarantined_quantity) < Number(line.quantity)) throw new Error("Lot no longer has enough quarantined quantity");
      if (header.disposition_type === "release" && lot.rows[0].expired) throw new Error("Expired stock cannot be released to sellable inventory");
      const layerAllocations = header.disposition_type === "release"
        ? await inventory.adjustLotLayerQuarantine(client, { companyId, lotId: line.lot_id, quantity: line.quantity, action: "release" })
        : await inventory.consumeQuarantinedLotLayers(client, { companyId, lotId: line.lot_id, quantity: line.quantity });
      if (Math.abs(layerAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) - Number(line.quantity)) > 0.00005) {
        throw new Error("Disposition quantity does not reconcile to its receipt layers");
      }
      for (const allocation of layerAllocations) {
        await client.query(
          `INSERT INTO erp_inventory_disposition_layer_allocations
           (company_id, disposition_line_id, layer_id, quantity, disposition_action, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, line.id, allocation.layerId, allocation.quantity, eventType, user.id],
        );
      }
      if (header.disposition_type === "release") {
        await client.query("UPDATE erp_inventory_lots SET quarantined_quantity = quarantined_quantity - $2, updated_at = NOW(), updated_by = $3 WHERE id = $1", [line.lot_id, line.quantity, user.id]);
      } else {
        const updated = await client.query("UPDATE erp_inventory_lots SET quantity = quantity - $2, quarantined_quantity = quarantined_quantity - $2, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND quantity >= $2 AND quarantined_quantity >= $2 RETURNING batch_no, expiry_date", [line.lot_id, line.quantity, user.id]);
        if (!updated.rowCount) throw new Error("Lot quantity changed before disposition posting");
        await client.query("UPDATE erp_stock_on_hand SET quantity = quantity - $4, last_movement_at = NOW(), updated_at = NOW(), updated_by = $5 WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3", [companyId, line.warehouse_id, line.item_id, line.quantity, user.id]);
        await client.query("INSERT INTO erp_stock_ledger (company_id, warehouse_id, item_id, movement_type, quantity, unit_cost, reference_type, reference_id, batch_no, expiry_date, created_by) VALUES ($1,$2,$3,'issue',-$4,$5,'inventory_disposition',$6,$7,$8,$9)", [companyId, line.warehouse_id, line.item_id, line.quantity, line.unit_cost, id, updated.rows[0].batch_no, updated.rows[0].expiry_date, user.id]);
      }
      await client.query("INSERT INTO erp_inventory_lot_events (company_id, warehouse_id, item_id, lot_id, event_type, quantity, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [companyId, line.warehouse_id, line.item_id, line.lot_id, eventType, line.quantity, header.reason, user.id]);
    } else {
      const balance = await client.query("SELECT quantity FROM erp_inventory_quarantine_balances WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE", [companyId, line.warehouse_id, line.item_id]);
      if (!balance.rowCount || Number(balance.rows[0].quantity) < Number(line.quantity)) throw new Error("Quarantine balance no longer covers this disposition");
      if (header.disposition_type === "release") {
        await client.query("UPDATE erp_inventory_quarantine_balances SET quantity = quantity - $4, updated_at = NOW(), updated_by = $5 WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3", [companyId, line.warehouse_id, line.item_id, line.quantity, user.id]);
      } else {
        await client.query("UPDATE erp_inventory_quarantine_balances SET quantity = quantity - $4, updated_at = NOW(), updated_by = $5 WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3", [companyId, line.warehouse_id, line.item_id, line.quantity, user.id]);
        const stockUpdate = await client.query("UPDATE erp_stock_on_hand SET quantity = quantity - $4, last_movement_at = NOW(), updated_at = NOW(), updated_by = $5 WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND quantity >= $4", [companyId, line.warehouse_id, line.item_id, line.quantity, user.id]);
        if (!stockUpdate.rowCount) throw new Error("Physical stock changed before disposition posting");
        await client.query("INSERT INTO erp_stock_ledger (company_id, warehouse_id, item_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by) VALUES ($1,$2,$3,'issue',-$4,$5,'inventory_disposition',$6,$7)", [companyId, line.warehouse_id, line.item_id, line.quantity, line.unit_cost, id, user.id]);
      }
      await client.query("INSERT INTO erp_inventory_quarantine_events (company_id, warehouse_id, item_id, source_type, source_id, event_type, quantity, reason, created_by) VALUES ($1,$2,$3,'inventory_disposition',$4,$5,$6,$7,$8)", [companyId, line.warehouse_id, line.item_id, id, eventType, line.quantity, header.reason, user.id]);
    }

    let journalId = null;
    const value = Number(line.quantity) * Number(line.unit_cost);
    if (header.disposition_type !== "release" && value > 0) {
      const account = await client.query("SELECT id, account_code, account_type FROM erp_chart_of_accounts WHERE company_id = $1 AND id = $2 AND is_active = TRUE AND is_postable = TRUE AND is_deleted = FALSE", [companyId, header.offset_account_id]);
      const inventoryAccount = await client.query("SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = $2 AND is_active = TRUE AND is_postable = TRUE AND is_deleted = FALSE", [companyId, ACCOUNT_CODES.inventory]);
      if (!account.rowCount || !inventoryAccount.rowCount) throw new Error("Disposition accounting accounts are missing or inactive");
      const expectedType = header.disposition_type === "write_off" ? "expense" : "asset";
      if (account.rows[0].account_type !== expectedType) throw new Error(`Disposition must use an active ${expectedType} offset account`);
      const journal = await gl.createJournalInTransaction(client, {
        companyId, userId: user.id, journalType: header.disposition_type === "write_off" ? "general" : "purchase",
        referenceNo: header.disposition_no, description: `${header.disposition_type === "write_off" ? "Quarantined stock write-off" : "Supplier return recovery"} ${header.disposition_no}`,
        lines: [
          { account_id: account.rows[0].id, debit: value, credit: 0, description: header.disposition_type === "write_off" ? "Inventory write-off expense" : "Supplier return claim" },
          { account_id: inventoryAccount.rows[0].id, debit: 0, credit: value, description: "Inventory control" },
        ],
      });
      await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId: user.id });
      journalId = journal.id;
    }
    await client.query("UPDATE erp_inventory_dispositions SET status = 'posted', journal_id = $3, posted_at = NOW(), posted_by = $4, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2", [id, companyId, journalId, user.id]);
    const sourceLayers = await client.query(
      `SELECT layer_id, quantity, disposition_action FROM erp_inventory_disposition_layer_allocations
       WHERE company_id = $1 AND disposition_line_id = $2 ORDER BY created_at, id`, [companyId, line.id],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_inventory_dispositions", entityId: id,
      action: `inventory_disposition_${header.disposition_type}_posted`,
      newValues: { disposition_no: header.disposition_no, disposition_type: header.disposition_type, quantity: Number(line.quantity), value, vendor_id: header.vendor_id, journal_id: journalId, source_layers: sourceLayers.rows } });
    await client.query("COMMIT");
    return { ok: true, id, disposition_no: header.disposition_no, status: "posted", journal_id: journalId, value };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

module.exports = { listQuarantined, getDispositionSetup, listDispositions, createDisposition, postDisposition };
