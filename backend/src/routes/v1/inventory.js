const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const inventory = require("../../services/inventoryService");
const stocktakes = require("../../services/stocktakeService");
const materialControls = require("../../services/materialControlService");
const stockAdjustments = require("../../services/stockAdjustmentService");
const inventoryLots = require("../../services/inventoryLotService");
const inventoryTransfers = require("../../services/inventoryTransferService");
const inventoryDispositions = require("../../services/inventoryDispositionService");
const { logAudit } = require("../../services/auditService");

const router = express.Router();
router.use(authenticateErp);

router.get("/stock", requirePermission("procurement.view"), async (req, res) => {
  const rows = await inventory.getStockOnHand(req.user.company_id, {
    warehouseId: req.query.warehouse_id,
    itemId: req.query.item_id,
    q: req.query.q,
    limit: req.query.limit || 50,
  });
  return res.json(rows);
});

router.get("/lots", requirePermission("procurement.view"), async (req, res) => {
  const rows = await inventory.getLotBalances(req.user.company_id, {
    warehouseId: req.query.warehouse_id,
    itemId: req.query.item_id,
    includeExpired: req.query.include_expired !== "false",
  });
  return res.json(rows);
});

router.get("/quarantine", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await inventoryDispositions.listQuarantined(req.user.company_id));
});
router.get("/quarantine/setup", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await inventoryDispositions.getDispositionSetup(req.user.company_id));
});
router.get("/quarantine/dispositions", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await inventoryDispositions.listDispositions(req.user.company_id));
});
router.post("/quarantine/dispositions", requirePermission("procurement.create"), async (req, res) => {
  try {
    const result = await inventoryDispositions.createDisposition({
      companyId: req.user.company_id, user: req.user,
      dispositionType: req.body?.disposition_type, warehouseId: req.body?.warehouse_id,
      itemId: req.body?.item_id, lotId: req.body?.lot_id,
      quantity: req.body?.quantity, reason: req.body?.reason,
      vendorId: req.body?.vendor_id, referenceNo: req.body?.reference_no,
      offsetAccountId: req.body?.offset_account_id,
    });
    return res.status(201).json(result);
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to create quarantine disposition" }); }
});
router.post("/quarantine/dispositions/:id/post", requirePermission("procurement.approve"), async (req, res) => {
  try {
    return res.json(await inventoryDispositions.postDisposition({ companyId: req.user.company_id, id: req.params.id, user: req.user }));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to post quarantine disposition" }); }
});

router.get("/lots/:lotId/events", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await inventoryLots.listEvents(req.user.company_id, req.params.lotId));
});
router.post("/lots/:lotId/quarantine", requirePermission("procurement.create"), async (req, res) => {
  try {
    return res.json(await inventoryLots.changeQuarantine({ companyId: req.user.company_id, lotId: req.params.lotId,
      user: req.user, action: "quarantine", quantity: req.body?.quantity, reason: req.body?.reason }));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to quarantine lot quantity" }); }
});
router.post("/lots/:lotId/release", requirePermission("procurement.approve"), async (req, res) => {
  try {
    return res.json(await inventoryLots.changeQuarantine({ companyId: req.user.company_id, lotId: req.params.lotId,
      user: req.user, action: "release", quantity: req.body?.quantity, reason: req.body?.reason }));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to release lot quantity" }); }
});

router.post("/lots/opening-reconciliation", requirePermission("procurement.approve"), async (req, res) => {
  const { warehouse_id: warehouseId, item_id: itemId, notes } = req.body || {};
  const lines = req.body?.lines;
  if (!warehouseId || !itemId || !String(notes || "").trim() || !Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: "Choose a warehouse and item, explain the reconciliation, and enter at least one lot" });
  }
  const seen = new Set();
  let total = 0;
  let totalValue = 0;
  for (const line of lines) {
    const batchNo = String(line?.batch_no || "").trim();
    const expiryDate = String(line?.expiry_date || "").slice(0, 10);
    const quantity = Number(line?.quantity);
    const unitCost = Number(line?.unit_cost);
    const key = `${batchNo}\u0000${expiryDate}`;
    if (!batchNo || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0 || seen.has(key)) {
      return res.status(400).json({ error: "Each lot needs a unique batch and expiry, positive quantity, and non-negative unit cost" });
    }
    seen.add(key);
    total += quantity;
    totalValue += quantity * unitCost;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const warehouse = await client.query("SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE FOR UPDATE", [warehouseId, req.user.company_id]);
    const item = await client.query("SELECT id FROM erp_items WHERE id = $1 AND company_id = $2 AND is_stock_item = TRUE AND is_active = TRUE AND is_deleted = FALSE FOR UPDATE", [itemId, req.user.company_id]);
    if (!warehouse.rowCount || !item.rowCount) throw new Error("Choose an active stock item and warehouse in this company");
    const stock = await client.query("SELECT quantity, avg_unit_cost FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE", [req.user.company_id, warehouseId, itemId]);
    const currentQuantity = Number(stock.rows[0]?.quantity || 0);
    if (currentQuantity <= 0 || Math.abs(total - currentQuantity) > 0.00005) throw new Error(`Lot quantities must exactly equal the current on-hand quantity (${currentQuantity})`);
    const currentValue = currentQuantity * Number(stock.rows[0]?.avg_unit_cost || 0);
    if (Math.abs(totalValue - currentValue) > 0.01) throw new Error(`Opening lot values must equal the current stock value (${currentValue.toFixed(2)})`);
    const existing = await client.query("SELECT COALESCE(SUM(quantity),0) AS quantity FROM erp_inventory_lots WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3", [req.user.company_id, warehouseId, itemId]);
    if (Number(existing.rows[0].quantity) > 0) throw new Error("This item and warehouse already have lot balances; use a reviewed stock movement to correct them");
    const opening = await client.query(
      `INSERT INTO erp_inventory_lot_openings (company_id, warehouse_id, item_id, notes, stock_quantity, lot_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.company_id, warehouseId, itemId, String(notes).trim().slice(0, 1000), currentQuantity, lines.length, req.user.id],
    );
    for (const line of lines) {
      const lot = await client.query(
        `INSERT INTO erp_inventory_lots (company_id, warehouse_id, item_id, batch_no, expiry_date, quantity, unit_cost, created_by, updated_by, opening_reconciliation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id`,
        [req.user.company_id, warehouseId, itemId, String(line.batch_no).trim(), String(line.expiry_date).slice(0, 10), Number(line.quantity), Number(line.unit_cost), req.user.id, opening.rows[0].id],
      );
      await client.query(
        `INSERT INTO erp_inventory_lot_layers
         (company_id, lot_id, source_type, source_reference_id, received_quantity, quantity_remaining, unit_cost, created_by)
         VALUES ($1,$2,'opening',$3,$4,$4,$5,$6)`,
        [req.user.company_id, lot.rows[0].id, opening.rows[0].id, Number(line.quantity), Number(line.unit_cost), req.user.id],
      );
    }
    await client.query("UPDATE erp_items SET lot_tracking_enabled = TRUE, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND company_id = $2", [itemId, req.user.company_id, req.user.id]);
    await logAudit({ client, companyId: req.user.company_id, userId: req.user.id, entityType: "erp_inventory_lot_openings", entityId: opening.rows[0].id, action: "inventory_lot_opening_reconciled", newValues: { warehouse_id: warehouseId, item_id: itemId, stock_quantity: currentQuantity, lot_count: lines.length, notes: String(notes).trim() } });
    await client.query("COMMIT");
    return res.status(201).json({ id: opening.rows[0].id, stock_quantity: currentQuantity, lot_count: lines.length });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: error.message || "Unable to reconcile opening lots" });
  } finally { client.release(); }
});

router.get("/reorder-alerts", requirePermission("procurement.view"), async (req, res) => {
  const rows = await inventory.getReorderAlerts(req.user.company_id, req.query.limit || 50);
  return res.json(rows);
});

router.get("/analysis", requirePermission("procurement.view"), async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);
  const warehouseId = String(req.query.warehouse_id || "");
  if (warehouseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(warehouseId)) {
    return res.status(400).json({ error: "warehouse_id must be a valid warehouse ID" });
  }
  const result = await pool.query(
    `WITH movement AS (
       SELECT company_id, warehouse_id, item_id,
         SUM(ABS(quantity)) FILTER (WHERE movement_type IN ('issue','sale') AND movement_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')) AS units_out,
         MAX(movement_date) AS last_movement_at
       FROM erp_stock_ledger WHERE company_id = $1 GROUP BY company_id, warehouse_id, item_id
     )
     SELECT i.id AS item_id, i.item_code, i.name AS item_name, COALESCE(cat.name, 'Uncategorized') AS category,
       w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
       s.quantity, i.reorder_point, s.avg_unit_cost, s.quantity * s.avg_unit_cost AS stock_value,
       COALESCE(m.units_out,0) AS units_out_period,
       CASE WHEN COALESCE(m.units_out,0) > 0 THEN s.quantity / (m.units_out / $2::numeric) END AS estimated_days_cover,
       m.last_movement_at,
       CASE WHEN s.quantity <= 0 THEN 'stockout'
         WHEN i.reorder_point > 0 AND s.quantity <= i.reorder_point THEN 'below_reorder'
         WHEN m.last_movement_at IS NULL OR m.last_movement_at < CURRENT_DATE - INTERVAL '90 days' THEN 'no_recent_movement'
         ELSE 'healthy' END AS analysis_status
     FROM erp_stock_on_hand s JOIN erp_items i ON i.id = s.item_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id LEFT JOIN erp_item_categories cat ON cat.id = i.category_id
     LEFT JOIN movement m ON m.company_id = s.company_id AND m.item_id = s.item_id AND m.warehouse_id = s.warehouse_id
     WHERE s.company_id = $1 AND s.is_deleted = FALSE AND i.is_deleted = FALSE
       AND ($3::uuid IS NULL OR s.warehouse_id = $3::uuid)
     ORDER BY CASE WHEN s.quantity <= 0 THEN 0 WHEN i.reorder_point > 0 AND s.quantity <= i.reorder_point THEN 1 ELSE 2 END,
       stock_value DESC LIMIT 3000`,
    [req.user.company_id, days, warehouseId || null],
  );
  return res.json({ days, rows: result.rows });
});

router.get("/adjustment-journals", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await stockAdjustments.list(req.user.company_id));
});
router.get("/adjustment-journals/:id", requirePermission("procurement.view"), async (req, res) => {
  const result = await stockAdjustments.get(req.user.company_id, req.params.id);
  return result ? res.json(result) : res.status(404).json({ error: "Stock adjustment not found" });
});
router.post("/adjustment-journals", requirePermission("procurement.create"), async (req, res) => {
  try {
    const result = await stockAdjustments.create({ companyId: req.user.company_id, user: req.user, warehouseId: req.body?.warehouse_id, date: req.body?.adjustment_date, reason: req.body?.reason, lines: req.body?.lines });
    return res.status(201).json(result);
  } catch (error) { return res.status(400).json({ error: error.message }); }
});
router.post("/adjustment-journals/:id/post", requirePermission("procurement.approve"), async (req, res) => {
  try {
    const result = await stockAdjustments.post({ companyId: req.user.company_id, id: req.params.id, user: req.user, note: req.body?.note });
    return res.json(result);
  } catch (error) { return res.status(400).json({ error: error.message }); }
});
router.post("/adjustment-journals/:id/cancel", requirePermission("procurement.create"), async (req, res) => {
  try { return res.json(await stockAdjustments.cancel({ companyId: req.user.company_id, id: req.params.id, user: req.user, note: req.body?.note })); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});

router.get("/material-requisitions", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await materialControls.listRequisitions(req.user.company_id, String(req.query.status || "")));
});
router.get("/material-requisitions/:id", requirePermission("procurement.view"), async (req, res) => {
  const result = await materialControls.getRequisition(req.user.company_id, req.params.id);
  return result ? res.json(result) : res.status(404).json({ error: "Material requisition not found" });
});
router.post("/material-requisitions", requirePermission("procurement.create"), async (req, res) => {
  try {
    const result = await materialControls.createRequisition({
      companyId: req.user.company_id, user: req.user, warehouseId: req.body?.warehouse_id,
      department: req.body?.department, requiredDate: req.body?.required_date,
      purpose: req.body?.purpose, lines: req.body?.lines,
    });
    return res.status(201).json(result);
  } catch (error) { return res.status(400).json({ error: error.message }); }
});
router.post("/material-requisitions/:id/submit", requirePermission("procurement.create"), async (req, res) => {
  try { return res.json(await materialControls.submitRequisition({ companyId: req.user.company_id, id: req.params.id, user: req.user })); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});
router.post("/material-requisitions/:id/review", requirePermission("procurement.approve"), async (req, res) => {
  try {
    return res.json(await materialControls.reviewRequisition({ companyId: req.user.company_id, id: req.params.id, user: req.user, decision: req.body?.decision, note: req.body?.note }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});
router.post("/material-requisitions/:id/issues", requirePermission("procurement.create"), async (req, res) => {
  try {
    return res.status(201).json(await materialControls.issueRequisition({ companyId: req.user.company_id, id: req.params.id, user: req.user, recipient: req.body?.recipient, lines: req.body?.lines, notes: req.body?.notes }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});
router.get("/material-issues", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await materialControls.listIssues(req.user.company_id));
});
router.get("/material-issues/:id", requirePermission("procurement.view"), async (req, res) => {
  const result = await materialControls.getIssue(req.user.company_id, req.params.id);
  return result ? res.json(result) : res.status(404).json({ error: "Material issue not found" });
});
router.get("/material-returns", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await materialControls.listReturns(req.user.company_id));
});
router.post("/material-issues/:id/returns", requirePermission("procurement.create"), async (req, res) => {
  try {
    return res.status(201).json(await materialControls.createMaterialReturn({ companyId: req.user.company_id, issueId: req.params.id, user: req.user, reason: req.body?.reason, lines: req.body?.lines }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.get("/movements", requirePermission("procurement.view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await pool.query(
    `SELECT sl.*, i.item_code, i.name AS item_name, w.code AS warehouse_code
     FROM erp_stock_ledger sl
     JOIN erp_items i ON i.id = sl.item_id
     JOIN erp_warehouses w ON w.id = sl.warehouse_id
     WHERE sl.company_id = $1
     ORDER BY sl.movement_date DESC LIMIT $2`,
    [req.user.company_id, limit],
  );
  return res.json(result.rows);
});

router.get("/fleet/locations", requirePermission("fleet.view"), async (req, res) => {
  const driver = stocktakes.isDriver(req.user);
  const result = await pool.query(
    `SELECT w.id, w.code, w.name, w.location_type, w.vehicle_registration,
            w.assigned_driver_user_id, u.full_name AS driver_name
     FROM erp_warehouses w
     LEFT JOIN erp_users u ON u.id = w.assigned_driver_user_id
     WHERE w.company_id = $1 AND w.is_active = TRUE AND w.is_deleted = FALSE
       AND ($2::boolean = FALSE OR w.assigned_driver_user_id = $3)
     ORDER BY CASE WHEN w.location_type = 'vehicle' THEN 0 ELSE 1 END, w.name`,
    [req.user.company_id, driver, req.user.id],
  );
  return res.json(result.rows);
});

router.get("/fleet/items", requirePermission("fleet.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT id, item_code, name FROM erp_items
     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE AND is_stock_item = TRUE
     ORDER BY item_code LIMIT 1000`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/fleet/vehicle-stock", requirePermission("fleet.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT w.id AS warehouse_id, w.name AS vehicle_name, w.vehicle_registration,
            i.id AS item_id, i.item_code, i.name AS item_name, u.code AS uom_code,
            COALESCE(s.quantity, 0) AS quantity
     FROM erp_warehouses w
     JOIN erp_items i ON i.company_id = w.company_id AND i.is_deleted = FALSE
       AND i.is_active = TRUE AND i.is_stock_item = TRUE
     LEFT JOIN erp_uom u ON u.id = i.uom_id
     LEFT JOIN erp_stock_on_hand s ON s.company_id = w.company_id
       AND s.warehouse_id = w.id AND s.item_id = i.id AND s.is_deleted = FALSE
     WHERE w.company_id = $1 AND w.location_type = 'vehicle'
       AND w.is_active = TRUE AND w.is_deleted = FALSE
       AND ($2::boolean = FALSE OR w.assigned_driver_user_id = $3)
     ORDER BY w.name, i.item_code`,
    [req.user.company_id, stocktakes.isDriver(req.user), req.user.id],
  );
  return res.json(result.rows);
});

router.get("/fleet/drivers", requirePermission("fleet.load"), async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.email
     FROM erp_users u JOIN erp_roles r ON r.id = u.role_id
     WHERE u.company_id = $1 AND u.status = 'active' AND u.is_deleted = FALSE
       AND LOWER(r.name) LIKE '%driver%'
     ORDER BY u.full_name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/fleet/vehicles", requirePermission("fleet.load"), async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const name = String(req.body?.name || "").trim();
  const registration = String(req.body?.vehicle_registration || "").trim().toUpperCase();
  const driverId = String(req.body?.assigned_driver_user_id || "").trim();
  if (!code || !name || !registration || !driverId) {
    return res.status(400).json({ error: "Vehicle code, name, registration and assigned driver are required" });
  }
  try {
    const driver = await pool.query(
      `SELECT u.id FROM erp_users u JOIN erp_roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.company_id = $2 AND u.status = 'active'
         AND u.is_deleted = FALSE AND LOWER(r.name) LIKE '%driver%'`,
      [driverId, req.user.company_id],
    );
    if (!driver.rowCount) return res.status(400).json({ error: "Choose an active Driver user in this company" });
    const result = await pool.query(
      `INSERT INTO erp_warehouses (
         company_id, code, name, location_type, vehicle_registration,
         assigned_driver_user_id, is_active, created_by
       ) VALUES ($1,$2,$3,'vehicle',$4,$5,TRUE,$6) RETURNING *`,
      [req.user.company_id, code, name, registration, driverId, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id, entityType: "erp_warehouses",
      entityId: result.rows[0].id, action: "vehicle_stock_location_created",
      newValues: result.rows[0], ipAddress: req.ip, userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(err.code === "23505" ? 409 : 500).json({
      error: err.code === "23505" ? "Vehicle code or registration is already in use" : "Unable to create vehicle stock location",
    });
  }
});

router.get("/fleet/stocktakes", requirePermission("fleet.view"), async (req, res) => {
  try {
    return res.json(await stocktakes.listStocktakes(req.user.company_id, req.user));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to load stock counts" });
  }
});

router.post("/fleet/stocktakes", requirePermission("fleet.count"), async (req, res) => {
  try {
    const session = await stocktakes.startStocktake({
      companyId: req.user.company_id,
      warehouseId: req.body?.warehouse_id,
      title: String(req.body?.title || "Physical stock count").trim(),
      user: req.user,
    });
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id, entityType: "erp_stocktake_sessions",
      entityId: session.id, action: "stocktake_started", newValues: { count_no: session.count_no, warehouse_id: session.warehouse_id },
      ipAddress: req.ip, userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(session);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Unable to start stock count" });
  }
});

router.get("/fleet/stocktakes/:stocktakeId", requirePermission("fleet.view"), async (req, res) => {
  try {
    const includeExpected = req.user.permissions?.includes("fleet.approve") || req.user.role === "Admin";
    return res.json(await stocktakes.getStocktake(
      req.user.company_id, req.params.stocktakeId, req.user, { includeExpected },
    ));
  } catch (err) {
    return res.status(err.message === "Stock count not found" ? 404 : 403).json({ error: err.message });
  }
});

router.post("/fleet/stocktakes/:stocktakeId/submit", requirePermission("fleet.count"), async (req, res) => {
  try {
    const session = await stocktakes.submitStocktake({
      companyId: req.user.company_id, stocktakeId: req.params.stocktakeId,
      counts: req.body?.counts, user: req.user,
    });
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id, entityType: "erp_stocktake_sessions",
      entityId: session.id, action: "stocktake_submitted", newValues: { status: session.status },
      ipAddress: req.ip, userAgent: req.headers["user-agent"],
    });
    return res.json(session);
  } catch (err) {
    return res.status(err.message === "Stock count not found" ? 404 : 400).json({ error: err.message });
  }
});

router.post("/fleet/stocktakes/:stocktakeId/review", requirePermission("fleet.approve"), async (req, res) => {
  try {
    const session = await stocktakes.reviewStocktake({
      companyId: req.user.company_id, stocktakeId: req.params.stocktakeId,
      decision: req.body?.decision, note: String(req.body?.note || "").trim(), user: req.user,
    });
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id, entityType: "erp_stocktake_sessions",
      entityId: session.id, action: session.status === "posted" ? "stocktake_variances_posted" : `stocktake_${session.status}`,
      newValues: { status: session.status, review_note: session.review_note },
      ipAddress: req.ip, userAgent: req.headers["user-agent"],
    });
    return res.json(session);
  } catch (err) {
    return res.status(err.message === "Submitted stock count not found" ? 404 : 400).json({ error: err.message });
  }
});

router.post("/stock-in", requirePermission("procurement.create"), (_req, res) => res.status(410).json({ error: "Direct stock receipts are retired. Receive goods against an approved purchase order." }));

router.post("/adjustments", requirePermission("procurement.create"), (_req, res) => res.status(410).json({ error: "Direct stock adjustments are retired. Create and approve an adjustment journal instead." }));

router.get("/transfers", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await inventoryTransfers.listTransfers(req.user.company_id, req.query.limit));
});

router.get("/transfers/:transferId", requirePermission("procurement.view"), async (req, res) => {
  const transfer = await inventoryTransfers.getTransfer(req.user.company_id, req.params.transferId);
  return transfer ? res.json(transfer) : res.status(404).json({ error: "Transfer not found" });
});

router.post("/transfers", requirePermission("procurement.create"), async (req, res) => {
  const { from_warehouse_id, to_warehouse_id, lines, notes } = req.body || {};
  if (!from_warehouse_id || !to_warehouse_id) {
    return res.status(400).json({ error: "from_warehouse_id and to_warehouse_id are required" });
  }
  try {
    const transfer = await inventoryTransfers.dispatchTransfer({
      companyId: req.user.company_id, fromWarehouseId: from_warehouse_id,
      toWarehouseId: to_warehouse_id, lines, notes, user: req.user,
    });
    return res.status(201).json(transfer);
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to dispatch transfer" }); }
});

router.post("/transfers/:transferId/receive", requirePermission("procurement.approve"), async (req, res) => {
  try {
    const result = await inventoryTransfers.receiveTransfer({
      companyId: req.user.company_id, transferId: req.params.transferId,
      lines: req.body?.lines, notes: req.body?.notes, user: req.user,
    });
    return res.json(result);
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to receive transfer" }); }
});

module.exports = router;
