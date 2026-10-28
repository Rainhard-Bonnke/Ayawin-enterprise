const pool = require("../db");
const inventory = require("./inventoryService");
const { logAudit } = require("./auditService");

function positiveLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw new Error("Add between 1 and 100 item lines");
  const seen = new Set();
  return lines.map((line) => {
    const itemId = String(line?.item_id || "");
    const quantity = Number(line?.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Each line needs an item and a positive quantity");
    if (seen.has(itemId)) throw new Error("Use one line per item");
    seen.add(itemId);
    return { itemId, quantity, notes: String(line?.notes || "").trim().slice(0, 500) };
  });
}

async function nextNumber(client, companyId, table, prefix) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${table}:${companyId}`]);
  const result = await client.query(`SELECT COUNT(*)::int + 1 AS next FROM ${table} WHERE company_id = $1`, [companyId]);
  return `${prefix}-${new Date().getFullYear()}-${String(result.rows[0].next).padStart(5, "0")}`;
}

async function validateItems(client, companyId, lines) {
  const result = await client.query(
    `SELECT id, uom_id FROM erp_items
     WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE AND is_deleted = FALSE AND is_stock_item = TRUE`,
    [companyId, lines.map((line) => line.itemId)],
  );
  if (result.rowCount !== lines.length) throw new Error("Choose active stocked items belonging to this company");
  return new Map(result.rows.map((row) => [row.id, row.uom_id]));
}

async function listRequisitions(companyId, status = "") {
  const result = await pool.query(
    `SELECT r.id, r.request_no, r.requested_by, r.requesting_department, r.required_date, r.purpose, r.status,
            r.created_at, r.submitted_at, r.approved_at, w.name AS warehouse_name,
            u.full_name AS requester_name,
            COUNT(l.id)::int AS line_count,
            COALESCE(SUM(l.requested_quantity),0) AS requested_units,
            COALESCE(SUM(l.issued_quantity),0) AS issued_units
     FROM erp_material_requisitions r
     JOIN erp_warehouses w ON w.id = r.warehouse_id
     JOIN erp_users u ON u.id = r.requested_by
     LEFT JOIN erp_material_requisition_lines l ON l.requisition_id = r.id
     WHERE r.company_id = $1 AND ($2 = '' OR r.status = $2)
     GROUP BY r.id, w.name, u.full_name ORDER BY r.created_at DESC LIMIT 300`,
    [companyId, status],
  );
  return result.rows;
}

async function getRequisition(companyId, id) {
  const header = await pool.query(
    `SELECT r.*, w.name AS warehouse_name, u.full_name AS requester_name,
            approver.full_name AS approver_name
     FROM erp_material_requisitions r JOIN erp_warehouses w ON w.id = r.warehouse_id
     JOIN erp_users u ON u.id = r.requested_by
     LEFT JOIN erp_users approver ON approver.id = r.approved_by
     WHERE r.company_id = $1 AND r.id = $2`, [companyId, id],
  );
  if (!header.rowCount) return null;
  const lines = await pool.query(
    `SELECT l.*, i.item_code, i.name AS item_name, u.code AS uom_code
     FROM erp_material_requisition_lines l JOIN erp_items i ON i.id = l.item_id
     LEFT JOIN erp_uom u ON u.id = l.uom_id
     WHERE l.company_id = $1 AND l.requisition_id = $2 ORDER BY l.line_no`,
    [companyId, id],
  );
  return { ...header.rows[0], lines: lines.rows };
}

async function createRequisition({ companyId, user, warehouseId, department, requiredDate, purpose, lines }) {
  const normalized = positiveLines(lines);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const warehouse = await client.query(
      "SELECT id FROM erp_warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE",
      [warehouseId, companyId],
    );
    if (!warehouse.rowCount) throw new Error("Choose an active warehouse in this company");
    const uoms = await validateItems(client, companyId, normalized);
    const requestNo = await nextNumber(client, companyId, "erp_material_requisitions", "MR");
    const header = await client.query(
      `INSERT INTO erp_material_requisitions
       (company_id, branch_id, request_no, warehouse_id, requesting_department, requested_by, required_date, purpose, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6) RETURNING *`,
      [companyId, user.default_branch_id || null, requestNo, warehouseId, String(department || "").trim().slice(0, 100), user.id, requiredDate || null, String(purpose).trim().slice(0, 1000)],
    );
    for (const [index, line] of normalized.entries()) {
      await client.query(
        `INSERT INTO erp_material_requisition_lines (company_id, requisition_id, line_no, item_id, requested_quantity, uom_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, header.rows[0].id, index + 1, line.itemId, line.quantity, uoms.get(line.itemId), line.notes, user.id],
      );
    }
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_material_requisitions", entityId: header.rows[0].id, action: "material_requisition_created", newValues: { request_no: requestNo, line_count: normalized.length } });
    await client.query("COMMIT");
    return getRequisition(companyId, header.rows[0].id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function submitRequisition({ companyId, id, user }) {
  const result = await pool.query(
    `UPDATE erp_material_requisitions SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND requested_by = $3 AND status = 'draft' RETURNING *`,
    [id, companyId, user.id],
  );
  if (!result.rowCount) throw new Error("Only the requester can submit a draft requisition");
  await logAudit({ companyId, userId: user.id, entityType: "erp_material_requisitions", entityId: id, action: "material_requisition_submitted", newValues: { status: "submitted" } });
  return getRequisition(companyId, id);
}

async function reviewRequisition({ companyId, id, user, decision, note }) {
  if (!["approve", "reject"].includes(decision)) throw new Error("Decision must be approve or reject");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM erp_material_requisitions WHERE id = $1 AND company_id = $2 AND status = 'submitted' FOR UPDATE", [id, companyId]);
    const request = found.rows[0];
    if (!request) throw new Error("Submitted requisition not found");
    if (request.requested_by === user.id) throw new Error("The requester cannot approve their own requisition");
    const nextStatus = decision === "approve" ? "approved" : "rejected";
    await client.query(
      `UPDATE erp_material_requisition_lines SET approved_quantity = CASE WHEN $3 = 'approved' THEN requested_quantity ELSE 0 END
       WHERE company_id = $1 AND requisition_id = $2`, [companyId, id, nextStatus],
    );
    await client.query(
      `UPDATE erp_material_requisitions SET status = $3, approved_at = NOW(), approved_by = $4, review_note = $5
       WHERE id = $1 AND company_id = $2`, [id, companyId, nextStatus, user.id, String(note || "").trim().slice(0, 1000) || null],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_material_requisitions", entityId: id, action: `material_requisition_${nextStatus}`, newValues: { status: nextStatus, note: note || null } });
    await client.query("COMMIT");
    return getRequisition(companyId, id);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function issueRequisition({ companyId, id, user, recipient, lines, notes }) {
  const requested = positiveLines(lines);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM erp_material_requisitions WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, companyId]);
    const requisition = found.rows[0];
    if (!requisition || !["approved", "partially_issued"].includes(requisition.status)) throw new Error("Only an approved, unfulfilled requisition can be issued");
    const requestLines = await client.query(
      `SELECT l.*, i.name AS item_name FROM erp_material_requisition_lines l JOIN erp_items i ON i.id = l.item_id
       WHERE l.company_id = $1 AND l.requisition_id = $2 FOR UPDATE OF l`, [companyId, id],
    );
    const lineMap = new Map(requestLines.rows.map((line) => [line.item_id, line]));
    for (const line of requested) {
      const requestLine = lineMap.get(line.itemId);
      const remaining = requestLine ? Number(requestLine.approved_quantity) - Number(requestLine.issued_quantity) : 0;
      if (!requestLine || line.quantity > remaining) throw new Error(`Issue quantity exceeds the approved balance for ${requestLine?.item_name || line.itemId}`);
    }
    const issueNo = await nextNumber(client, companyId, "erp_material_issues", "MI");
    const header = await client.query(
      `INSERT INTO erp_material_issues (company_id, requisition_id, issue_no, recipient_name, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [companyId, id, issueNo, String(recipient || "").trim().slice(0, 180), String(notes || "").trim().slice(0, 1000) || null, user.id],
    );
    if (!String(recipient || "").trim()) throw new Error("Enter the recipient name");
    for (const line of requested) {
      const requestLine = lineMap.get(line.itemId);
      const issued = await inventory.recordIssue(client, {
        companyId, warehouseId: requisition.warehouse_id, itemId: line.itemId, quantity: line.quantity,
        referenceType: "material_issue", referenceId: header.rows[0].id, userId: user.id, returnAllocations: true,
      });
      const issueLine = await client.query(
        `INSERT INTO erp_material_issue_lines (company_id, issue_id, requisition_line_id, item_id, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [companyId, header.rows[0].id, requestLine.id, line.itemId, line.quantity, issued.unitCost],
      );
      for (const allocation of issued.allocations) {
        if (!allocation.layerId || !allocation.batchNo || !allocation.expiryDate) continue;
        await client.query(
          `INSERT INTO erp_material_issue_layer_allocations
           (company_id, issue_line_id, layer_id, batch_no, expiry_date, quantity, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [companyId, issueLine.rows[0].id, allocation.layerId, allocation.batchNo, allocation.expiryDate, allocation.quantity, user.id],
        );
      }
      await client.query("UPDATE erp_material_requisition_lines SET issued_quantity = issued_quantity + $3 WHERE id = $1 AND company_id = $2", [requestLine.id, companyId, line.quantity]);
    }
    const outstanding = await client.query(
      "SELECT COUNT(*)::int AS n FROM erp_material_requisition_lines WHERE company_id = $1 AND requisition_id = $2 AND issued_quantity < approved_quantity",
      [companyId, id],
    );
    const status = Number(outstanding.rows[0].n) ? "partially_issued" : "issued";
    await client.query("UPDATE erp_material_requisitions SET status = $3 WHERE id = $1 AND company_id = $2", [id, companyId, status]);
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_material_issues", entityId: header.rows[0].id, action: "material_issue_posted", newValues: { issue_no: issueNo, requisition_id: id, line_count: requested.length } });
    await client.query("COMMIT");
    return { ...header.rows[0], issue_no: issueNo, requisition_status: status };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function listIssues(companyId) {
  const result = await pool.query(
    `SELECT i.id, i.issue_no, i.issue_date, i.recipient_name, i.status, i.notes,
            r.request_no, r.requesting_department, w.name AS warehouse_name,
            COUNT(l.id)::int AS line_count, COALESCE(SUM(l.quantity),0) AS quantity
     FROM erp_material_issues i JOIN erp_material_requisitions r ON r.id = i.requisition_id
     JOIN erp_warehouses w ON w.id = r.warehouse_id LEFT JOIN erp_material_issue_lines l ON l.issue_id = i.id
     WHERE i.company_id = $1 GROUP BY i.id, r.request_no, r.requesting_department, w.name
     ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 300`, [companyId],
  );
  return result.rows;
}

async function getIssue(companyId, id) {
  const header = await pool.query(
    `SELECT i.*, r.request_no, r.requesting_department, r.warehouse_id, w.name AS warehouse_name
     FROM erp_material_issues i JOIN erp_material_requisitions r ON r.id = i.requisition_id
     JOIN erp_warehouses w ON w.id = r.warehouse_id
     WHERE i.company_id = $1 AND i.id = $2`, [companyId, id],
  );
  if (!header.rowCount) return null;
  const lines = await pool.query(
    `SELECT il.*, i.item_code, i.name AS item_name, u.code AS uom_code,
       i.lot_tracking_enabled,
       GREATEST(il.quantity - COALESCE((SELECT SUM(rl.quantity) FROM erp_material_return_lines rl
         JOIN erp_material_returns mr ON mr.id = rl.return_id
         WHERE mr.company_id = $1 AND mr.issue_id = il.issue_id AND mr.status = 'posted' AND rl.issue_line_id = il.id),0),0) AS returnable_quantity,
       COALESCE((SELECT json_agg(json_build_object(
         'batch_no', issued.batch_no, 'expiry_date', issued.expiry_date,
         'quantity', issued.quantity, 'returnable_quantity', GREATEST(issued.quantity - COALESCE(returned.quantity, 0), 0)
       ) ORDER BY issued.expiry_date NULLS LAST, issued.batch_no)
       FROM (
         SELECT batch_no, expiry_date, SUM(ABS(quantity)) AS quantity
         FROM erp_stock_ledger
         WHERE company_id = $1 AND reference_type = 'material_issue' AND reference_id = il.issue_id
           AND item_id = il.item_id AND movement_type = 'issue'
         GROUP BY batch_no, expiry_date
       ) issued
       LEFT JOIN (
         SELECT batch_no, expiry_date, SUM(quantity) AS quantity
         FROM erp_material_return_lines WHERE company_id = $1 AND issue_line_id = il.id
         GROUP BY batch_no, expiry_date
       ) returned ON returned.batch_no IS NOT DISTINCT FROM issued.batch_no
                 AND returned.expiry_date IS NOT DISTINCT FROM issued.expiry_date), '[]'::json) AS issued_lots
     FROM erp_material_issue_lines il JOIN erp_items i ON i.id = il.item_id LEFT JOIN erp_uom u ON u.id = i.uom_id
     WHERE il.company_id = $1 AND il.issue_id = $2 ORDER BY i.item_code`, [companyId, id],
  );
  return { ...header.rows[0], lines: lines.rows };
}

async function listReturns(companyId) {
  const result = await pool.query(
    `SELECT r.id, r.return_no, r.return_date, r.status, r.reason, i.issue_no, i.recipient_name,
            COUNT(l.id)::int AS line_count, COALESCE(SUM(l.quantity),0) AS quantity,
            COUNT(l.id) FILTER (WHERE l.condition = 'damaged')::int AS damaged_lines
     FROM erp_material_returns r JOIN erp_material_issues i ON i.id = r.issue_id
     LEFT JOIN erp_material_return_lines l ON l.return_id = r.id
     WHERE r.company_id = $1 GROUP BY r.id, i.issue_no, i.recipient_name
     ORDER BY r.return_date DESC, r.created_at DESC LIMIT 300`, [companyId],
  );
  return result.rows;
}

async function createMaterialReturn({ companyId, issueId, user, reason, lines }) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw new Error("Add between 1 and 100 return lines");
  const seen = new Set();
  const normalized = lines.map((line) => {
    const itemId = String(line?.item_id || "");
    const issueLineId = String(line?.issue_line_id || "");
    const batchNo = String(line?.batch_no || "").trim() || null;
    const expiryDate = String(line?.expiry_date || "").slice(0, 10) || null;
    const quantity = Number(line?.quantity);
    const condition = String(line?.condition || "");
    const notes = String(line?.notes || "").trim().slice(0, 500);
    if (!itemId || !issueLineId || !Number.isFinite(quantity) || quantity <= 0 || !["good", "damaged"].includes(condition) || Boolean(batchNo) !== Boolean(expiryDate)) {
      throw new Error("Each return line needs an issue line, positive quantity, condition, and a complete optional lot identity");
    }
    const key = `${issueLineId}|${batchNo || ""}|${expiryDate || ""}`;
    if (seen.has(key)) throw new Error("Combine duplicate return lines for the same issue lot");
    seen.add(key);
    return { itemId, issueLineId, batchNo, expiryDate, quantity, condition, notes };
  });
  if (!String(reason || "").trim()) throw new Error("Return reason is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const issueResult = await client.query(
      `SELECT i.*, r.warehouse_id FROM erp_material_issues i JOIN erp_material_requisitions r ON r.id = i.requisition_id
       WHERE i.id = $1 AND i.company_id = $2 AND i.status = 'posted' FOR UPDATE OF i`, [issueId, companyId],
    );
    const issue = issueResult.rows[0];
    if (!issue) throw new Error("Posted issue not found");
    const issueLines = await client.query("SELECT * FROM erp_material_issue_lines WHERE company_id = $1 AND issue_id = $2 FOR UPDATE", [companyId, issueId]);
    const returnLines = await client.query(
      `SELECT rl.issue_line_id, rl.source_layer_id, rl.batch_no, rl.expiry_date, SUM(rl.quantity) AS quantity FROM erp_material_return_lines rl
       JOIN erp_material_returns r ON r.id = rl.return_id WHERE r.company_id = $1 AND r.issue_id = $2 AND r.status = 'posted'
       GROUP BY rl.issue_line_id, rl.source_layer_id, rl.batch_no, rl.expiry_date`, [companyId, issueId],
    );
    const returned = new Map();
    const returnedByLayer = new Map();
    for (const row of returnLines.rows) {
      const lotKey = `${row.issue_line_id}|${row.batch_no || ""}|${String(row.expiry_date || "").slice(0, 10)}`;
      returned.set(lotKey, (returned.get(lotKey) || 0) + Number(row.quantity));
      if (row.source_layer_id) returnedByLayer.set(String(row.source_layer_id), (returnedByLayer.get(String(row.source_layer_id)) || 0) + Number(row.quantity));
    }
    const legacyReturnedByLot = new Map();
    for (const row of returnLines.rows.filter((entry) => !entry.source_layer_id)) {
      const key = `${row.issue_line_id}|${row.batch_no || ""}|${String(row.expiry_date || "").slice(0, 10)}`;
      legacyReturnedByLot.set(key, (legacyReturnedByLot.get(key) || 0) + Number(row.quantity));
    }
    const itemById = new Map(issueLines.rows.map((line) => [line.id, line]));
    const issuedByLot = await client.query(
      `SELECT item_id, batch_no, expiry_date, SUM(ABS(quantity)) AS quantity
       FROM erp_stock_ledger WHERE company_id = $1 AND reference_type = 'material_issue' AND reference_id = $2
         AND movement_type = 'issue' GROUP BY item_id, batch_no, expiry_date`, [companyId, issueId],
    );
    const issueLayerRows = await client.query(
      `SELECT a.issue_line_id, a.layer_id, a.batch_no, a.expiry_date, a.quantity
       FROM erp_material_issue_layer_allocations a
       WHERE a.company_id = $1 AND a.issue_line_id = ANY($2::uuid[])
       ORDER BY a.created_at, a.id`, [companyId, issueLines.rows.map((line) => line.id)],
    );
    const layerAllocationsByReturnLine = new Map();
    for (const line of normalized) {
      const issueLine = itemById.get(line.issueLineId);
      if (!issueLine || issueLine.item_id !== line.itemId) throw new Error("Return line must match an item on the original issue");
      if (issueLine.lot_tracking_enabled && (!line.batchNo || !line.expiryDate)) throw new Error("Tracked item returns must identify the original issued batch and expiry");
      const sourceLot = issuedByLot.rows.find((lot) => lot.item_id === line.itemId && (lot.batch_no || null) === line.batchNo && (String(lot.expiry_date || "").slice(0, 10) || null) === line.expiryDate);
      const lotKey = `${line.issueLineId}|${line.batchNo || ""}|${line.expiryDate || ""}`;
      if ((issueLine.lot_tracking_enabled && !sourceLot) || (sourceLot && line.quantity > Number(sourceLot.quantity) - (returned.get(lotKey) || 0))) {
        throw new Error("Return quantity exceeds the unreturned quantity from this issued batch");
      }
      if (!issueLine.lot_tracking_enabled && line.quantity > Number(issueLine.quantity) - (returned.get(lotKey) || 0)) throw new Error("Return quantity exceeds the unreturned quantity issued");
      if (issueLine.lot_tracking_enabled) {
        const candidates = issueLayerRows.rows.filter((allocation) => allocation.issue_line_id === line.issueLineId
          && allocation.batch_no === line.batchNo && String(allocation.expiry_date).slice(0, 10) === line.expiryDate);
        let remaining = line.quantity;
        let legacyToConsume = legacyReturnedByLot.get(lotKey) || 0;
        const picked = [];
        for (const candidate of candidates) {
          const alreadyReturned = returnedByLayer.get(String(candidate.layer_id)) || 0;
          let available = Math.max(0, Number(candidate.quantity) - alreadyReturned);
          const applyLegacy = Math.min(available, legacyToConsume);
          available -= applyLegacy;
          legacyToConsume -= applyLegacy;
          const pickedQuantity = Math.min(remaining, available);
          if (pickedQuantity > 0.00005) picked.push({ layerId: candidate.layer_id, quantity: pickedQuantity });
          remaining -= pickedQuantity;
          if (remaining <= 0.00005) break;
        }
        if (remaining > 0.00005 && candidates.length) throw new Error("Return quantity exceeds the unreturned quantity from its exact issue layers");
        layerAllocationsByReturnLine.set(line, candidates.length ? picked : [{ layerId: null, quantity: line.quantity }]);
      } else {
        layerAllocationsByReturnLine.set(line, [{ layerId: null, quantity: line.quantity }]);
      }
    }
    const returnNo = await nextNumber(client, companyId, "erp_material_returns", "MRN");
    const header = await client.query(
      `INSERT INTO erp_material_returns (company_id, issue_id, return_no, reason, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [companyId, issueId, returnNo, String(reason).trim().slice(0, 1000), user.id],
    );
    for (const line of normalized) {
      const issueLine = itemById.get(line.issueLineId);
      for (const allocation of layerAllocationsByReturnLine.get(line) || [{ layerId: null, quantity: line.quantity }]) {
        await client.query(
          `INSERT INTO erp_material_return_lines (company_id, return_id, issue_line_id, quantity, condition, notes, batch_no, expiry_date, source_layer_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [companyId, header.rows[0].id, line.issueLineId, allocation.quantity, line.condition, line.notes || null, line.batchNo, line.expiryDate, allocation.layerId],
        );
        // Returned units re-enter physical custody. Good units are sellable;
        // damaged units enter quarantine so ATP and FEFO cannot allocate them.
        const received = await inventory.recordReceipt(client, {
            companyId, warehouseId: issue.warehouse_id, itemId: line.itemId, quantity: allocation.quantity,
            batchNo: line.batchNo, expiryDate: line.expiryDate,
            unitCost: Number(issueLine.unit_cost), referenceType: "material_return", referenceId: header.rows[0].id,
            userId: user.id, sourceType: "material_return", parentLayerId: allocation.layerId,
            allowExpiredForQuarantine: line.condition === "damaged",
          });
        if (line.condition === "damaged") {
          const quarantineReason = `Damaged material return ${returnNo}: ${line.notes || reason}`.slice(0, 1000);
          if (received?.lotId && received?.layerId) {
            const [lotUpdate, layerUpdate] = await Promise.all([
              client.query(
                `UPDATE erp_inventory_lots SET quarantined_quantity = quarantined_quantity + $2, updated_by = $3
                 WHERE id = $1 AND company_id = $4 AND quantity - quarantined_quantity >= $2 RETURNING id`,
                [received.lotId, allocation.quantity, user.id, companyId],
              ),
              client.query(
                `UPDATE erp_inventory_lot_layers SET quarantined_quantity = quarantined_quantity + $2
                 WHERE id = $1 AND company_id = $3 AND quantity_remaining - quarantined_quantity >= $2 RETURNING id`,
                [received.layerId, allocation.quantity, companyId],
              ),
            ]);
            if (!lotUpdate.rowCount || !layerUpdate.rowCount) throw new Error("Damaged return did not reconcile to its tracked quarantine layer");
            await client.query(
              `INSERT INTO erp_inventory_lot_events (company_id, warehouse_id, item_id, lot_id, event_type, quantity, reason, created_by)
               VALUES ($1,$2,$3,$4,'quarantined',$5,$6,$7)`,
              [companyId, issue.warehouse_id, line.itemId, received.lotId, allocation.quantity, quarantineReason, user.id],
            );
          } else {
            await client.query(
              `INSERT INTO erp_inventory_quarantine_balances (company_id, warehouse_id, item_id, quantity, updated_by)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id, warehouse_id, item_id)
               DO UPDATE SET quantity = erp_inventory_quarantine_balances.quantity + EXCLUDED.quantity,
                 updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
              [companyId, issue.warehouse_id, line.itemId, allocation.quantity, user.id],
            );
            await client.query(
              `INSERT INTO erp_inventory_quarantine_events (company_id, warehouse_id, item_id, source_type, source_id, event_type, quantity, reason, created_by)
               VALUES ($1,$2,$3,'material_return',$4,'quarantined',$5,$6,$7)`,
              [companyId, issue.warehouse_id, line.itemId, header.rows[0].id, allocation.quantity, quarantineReason, user.id],
            );
          }
        }
      }
    }
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_material_returns", entityId: header.rows[0].id, action: "material_return_posted", newValues: { return_no: returnNo, issue_id: issueId, line_count: normalized.length } });
    await client.query("COMMIT");
    return { ...header.rows[0], return_no: returnNo };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

module.exports = {
  listRequisitions, getRequisition, createRequisition, submitRequisition, reviewRequisition,
  issueRequisition, listIssues, getIssue, listReturns, createMaterialReturn,
};
