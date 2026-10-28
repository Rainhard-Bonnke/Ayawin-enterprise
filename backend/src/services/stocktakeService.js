const pool = require("../db");
const inventory = require("./inventoryService");

function isDriver(user) {
  return String(user?.role_name || user?.role || "")
    .toLowerCase()
    .includes("driver");
}

async function assertLocationAccess(client, companyId, warehouseId, user) {
  const result = await client.query(
    `SELECT id, name, location_type, assigned_driver_user_id
     FROM erp_warehouses
     WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
    [warehouseId, companyId],
  );
  const location = result.rows[0];
  if (!location) throw new Error("Stock location not found");
  if (
    isDriver(user) &&
    (location.location_type !== "vehicle" || location.assigned_driver_user_id !== user.id)
  ) {
    throw new Error("Drivers can only count their assigned vehicle stock");
  }
  return location;
}

async function listStocktakes(companyId, user) {
  const result = await pool.query(
    `SELECT st.id, st.count_no, st.title, st.status, st.snapshot_at, st.submitted_at,
            st.reviewed_at, st.posted_at, st.created_at, w.code AS location_code,
            w.name AS location_name, w.location_type,
            COUNT(sl.id)::int AS line_count,
            COUNT(sl.id) FILTER (WHERE sl.variance <> 0)::int AS variance_count,
            u.full_name AS counted_by_name
     FROM erp_stocktake_sessions st
     JOIN erp_warehouses w ON w.id = st.warehouse_id
     LEFT JOIN erp_stocktake_lines sl ON sl.stocktake_id = st.id
     LEFT JOIN erp_users u ON u.id = st.submitted_by
     WHERE st.company_id = $1
       AND ($2::boolean = FALSE OR w.assigned_driver_user_id = $3)
     GROUP BY st.id, w.id, u.full_name
     ORDER BY st.created_at DESC LIMIT 100`,
    [companyId, isDriver(user), user.id],
  );
  return result.rows;
}

async function startStocktake({ companyId, warehouseId, title, user }) {
  if (!String(title || "").trim()) throw new Error("Enter a stock count title");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const location = await assertLocationAccess(client, companyId, warehouseId, user);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `stocktake:${companyId}:${warehouseId}`,
    ]);
    const seq = await client.query(
      "SELECT COUNT(*)::int + 1 AS next FROM erp_stocktake_sessions WHERE company_id = $1",
      [companyId],
    );
    const countNo = `SC-${new Date().getFullYear()}-${String(seq.rows[0].next).padStart(5, "0")}`;
    const sessionResult = await client.query(
      `INSERT INTO erp_stocktake_sessions (company_id, count_no, warehouse_id, title, status, created_by)
       VALUES ($1,$2,$3,$4,'counting',$5) RETURNING *`,
      [companyId, countNo, warehouseId, title, user.id],
    );
    const session = sessionResult.rows[0];
    await client.query(
      `INSERT INTO erp_stocktake_lines (company_id, stocktake_id, item_id, expected_quantity, unit_cost)
       SELECT $1, $2, i.id, COALESCE(s.quantity, 0), COALESCE(s.avg_unit_cost, 0)
       FROM erp_items i
       LEFT JOIN erp_stock_on_hand s ON s.company_id = i.company_id
         AND s.item_id = i.id AND s.warehouse_id = $3 AND s.is_deleted = FALSE
       WHERE i.company_id = $1 AND i.is_deleted = FALSE AND i.is_active = TRUE AND i.is_stock_item = TRUE`,
      [companyId, session.id, warehouseId],
    );
    await client.query("COMMIT");
    return { ...session, location_name: location.name };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      throw new Error("An open count already exists for this stock location");
    throw error;
  } finally {
    client.release();
  }
}

async function getStocktake(companyId, stocktakeId, user, { includeExpected = false } = {}) {
  const header = await pool.query(
    `SELECT st.*, w.name AS location_name, w.code AS location_code, w.location_type,
            w.assigned_driver_user_id, submitter.full_name AS submitted_by_name,
            reviewer.full_name AS reviewed_by_name
     FROM erp_stocktake_sessions st
     JOIN erp_warehouses w ON w.id = st.warehouse_id
     LEFT JOIN erp_users submitter ON submitter.id = st.submitted_by
     LEFT JOIN erp_users reviewer ON reviewer.id = st.reviewed_by
     WHERE st.id = $1 AND st.company_id = $2`,
    [stocktakeId, companyId],
  );
  const session = header.rows[0];
  if (!session) throw new Error("Stock count not found");
  if (
    isDriver(user) &&
    (session.location_type !== "vehicle" || session.assigned_driver_user_id !== user.id)
  ) {
    throw new Error("Stock count not found");
  }
  const lines = await pool.query(
    `SELECT sl.id, sl.item_id, i.item_code, i.name AS item_name, u.code AS uom_code, sl.counted_quantity,
            sl.notes, CASE WHEN $3::boolean THEN sl.expected_quantity END AS expected_quantity,
            CASE WHEN $3::boolean THEN sl.variance END AS variance
     FROM erp_stocktake_lines sl
     JOIN erp_items i ON i.id = sl.item_id
     LEFT JOIN erp_uom u ON u.id = i.uom_id
     WHERE sl.company_id = $1 AND sl.stocktake_id = $2
     ORDER BY i.item_code`,
    [companyId, stocktakeId, includeExpected],
  );
  return { ...session, lines: lines.rows };
}

async function submitStocktake({ companyId, stocktakeId, counts, user }) {
  if (!Array.isArray(counts) || counts.length === 0)
    throw new Error("Enter a count for every listed item");
  const uniqueIds = new Set();
  for (const line of counts) {
    if (String(line.counted_quantity ?? "").trim() === "") {
      throw new Error("Enter a quantity for every item; use zero when none is on hand");
    }
    const qty = Number(line.counted_quantity);
    if (!line.line_id || uniqueIds.has(line.line_id) || !Number.isFinite(qty) || qty < 0) {
      throw new Error("Each item needs one valid, non-negative physical quantity");
    }
    uniqueIds.add(line.line_id);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessionResult = await client.query(
      `SELECT st.* FROM erp_stocktake_sessions st
       WHERE st.id = $1 AND st.company_id = $2 FOR UPDATE`,
      [stocktakeId, companyId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new Error("Stock count not found");
    await assertLocationAccess(client, companyId, session.warehouse_id, user);
    if (session.status !== "counting") throw new Error("Only an active count can be submitted");
    const lineResult = await client.query(
      "SELECT id FROM erp_stocktake_lines WHERE company_id = $1 AND stocktake_id = $2",
      [companyId, stocktakeId],
    );
    if (
      lineResult.rowCount !== counts.length ||
      lineResult.rows.some((row) => !uniqueIds.has(row.id))
    ) {
      throw new Error("Submit a physical count for every item in the session");
    }
    for (const line of counts) {
      await client.query(
        `UPDATE erp_stocktake_lines
         SET counted_quantity = $3,
             variance = $3 - expected_quantity,
             notes = $4, counted_at = NOW(), counted_by = $5
         WHERE id = $1 AND stocktake_id = $2 AND company_id = $6`,
        [
          line.line_id,
          stocktakeId,
          Number(line.counted_quantity),
          line.notes || null,
          user.id,
          companyId,
        ],
      );
    }
    const updated = await client.query(
      `UPDATE erp_stocktake_sessions SET status = 'submitted', submitted_at = NOW(),
       submitted_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [stocktakeId, companyId, user.id],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reviewStocktake({ companyId, stocktakeId, decision, note, user }) {
  if (!["approve", "reject"].includes(decision))
    throw new Error("Decision must be approve or reject");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_stocktake_sessions
       WHERE id = $1 AND company_id = $2 AND status = 'submitted' FOR UPDATE`,
      [stocktakeId, companyId],
    );
    const session = result.rows[0];
    if (!session) throw new Error("Submitted stock count not found");
    if (decision === "reject") {
      const rejected = await client.query(
        `UPDATE erp_stocktake_sessions SET status = 'rejected', reviewed_at = NOW(),
         reviewed_by = $3, review_note = $4, updated_at = NOW()
         WHERE id = $1 AND company_id = $2 RETURNING *`,
        [
          stocktakeId,
          companyId,
          user.id,
          note || "Count rejected; create a new count after investigation.",
        ],
      );
      await client.query("COMMIT");
      return rejected.rows[0];
    }

    const lines = await client.query(
      `SELECT sl.*, i.name AS item_name
       FROM erp_stocktake_lines sl JOIN erp_items i ON i.id = sl.item_id
       WHERE sl.company_id = $1 AND sl.stocktake_id = $2 ORDER BY i.item_code`,
      [companyId, stocktakeId],
    );
    for (const line of lines.rows) {
      const current = await client.query(
        `SELECT quantity FROM erp_stock_on_hand
         WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND is_deleted = FALSE FOR UPDATE`,
        [companyId, session.warehouse_id, line.item_id],
      );
      const quantityNow = Number(current.rows[0]?.quantity || 0);
      if (Math.abs(quantityNow - Number(line.expected_quantity)) > 0.0001) {
        const changed = await client.query(
          `UPDATE erp_stocktake_sessions SET status = 'recount_required', reviewed_at = NOW(),
           reviewed_by = $3, review_note = $4, updated_at = NOW()
           WHERE id = $1 AND company_id = $2 RETURNING *`,
          [
            stocktakeId,
            companyId,
            user.id,
            `Stock moved after count start for ${line.item_name}; recount required. No adjustments were posted.`,
          ],
        );
        await client.query("COMMIT");
        return changed.rows[0];
      }
    }

    for (const line of lines.rows) {
      const delta = Number(line.variance || 0);
      if (delta > 0) {
        await inventory.recordReceipt(client, {
          companyId,
          warehouseId: session.warehouse_id,
          itemId: line.item_id,
          quantity: delta,
          unitCost: Number(line.unit_cost || 0),
          referenceType: "stocktake",
          referenceId: stocktakeId,
          userId: user.id,
        });
      } else if (delta < 0) {
        await inventory.recordIssue(client, {
          companyId,
          warehouseId: session.warehouse_id,
          itemId: line.item_id,
          quantity: Math.abs(delta),
          unitCost: Number(line.unit_cost || 0),
          referenceType: "stocktake",
          referenceId: stocktakeId,
          userId: user.id,
        });
      }
    }
    const posted = await client.query(
      `UPDATE erp_stocktake_sessions SET status = 'posted', reviewed_at = NOW(),
       reviewed_by = $3, review_note = $4, posted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [stocktakeId, companyId, user.id, note || null],
    );
    await client.query("COMMIT");
    return posted.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  isDriver,
  listStocktakes,
  startStocktake,
  getStocktake,
  submitStocktake,
  reviewStocktake,
};
