const crypto = require("crypto");
const pool = require("../db");

const PROVIDER = (process.env.INTELLIGENCE_PROVIDER || "local").toLowerCase();
const MODEL =
  PROVIDER === "gemini"
    ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
    : PROVIDER === "openai"
      ? process.env.OPENAI_MODEL || "gpt-4.1-mini"
      : "local";

function calculateInventoryFindings(rows, { analysisDate = new Date() } = {}) {
  const now = analysisDate.getTime();
  return rows.flatMap((row) => {
    const quantity = Number(row.quantity || 0);
    const reorderPoint = Number(row.reorder_point || 0);
    const unitsSold14d = Number(row.units_sold_14d || 0);
    const dailyVelocity = unitsSold14d / 14;
    const daysOfStock = dailyVelocity > 0 ? quantity / dailyVelocity : null;
    const findings = [];
    const identity = `${row.item_code} at ${row.warehouse_name}`;

    if (quantity <= 0) {
      findings.push({
        category: "stockout",
        severity: "critical",
        confidence: 0.99,
        entityType: "erp_stock_on_hand",
        entityId: String(row.stock_id),
        title: `Stockout: ${identity}`,
        finding: `${identity} has no stock available.`,
        recommendation: "Create an approved replenishment request before accepting more orders.",
      });
    } else if (reorderPoint > 0 && quantity <= reorderPoint) {
      const severity = daysOfStock !== null && daysOfStock <= 3 ? "high" : "medium";
      findings.push({
        category: "reorder_risk",
        severity,
        confidence: 0.97,
        entityType: "erp_stock_on_hand",
        entityId: String(row.stock_id),
        title: `Reorder risk: ${identity}`,
        finding: `${identity} has ${quantity} units against a reorder point of ${reorderPoint}${daysOfStock === null ? "" : ` and approximately ${daysOfStock.toFixed(1)} days of stock remaining`}.`,
        recommendation:
          "Review supplier lead time and prepare a replenishment request for approval.",
      });
    }

    // Legacy issues were not allocated to lots. Only publish expiry exposure
    // when tagged ledger quantity is reconcilable with the stock control total.
    if (row.expiry_date && row.expiry_balance_reconciled) {
      const daysToExpiry = (new Date(row.expiry_date).getTime() - now) / 86400000;
      if (daysToExpiry <= 45) {
        findings.push({
          category: "expiry_risk",
          severity: daysToExpiry <= 0 ? "critical" : "high",
          confidence: 0.98,
          entityType: "erp_stock_on_hand",
          entityId: String(row.stock_id),
          title: `Expiry risk: ${identity}`,
          finding: `${identity} has stock with an expiry date of ${String(row.expiry_date).slice(0, 10)}.`,
          recommendation:
            "Prioritize FEFO dispatch and review the batch before replenishing this item.",
        });
      }
    }

    return findings;
  });
}

async function collectInventoryFacts(companyId) {
  const result = await pool.query(
    `WITH sales AS (
       SELECT company_id, item_id, warehouse_id, SUM(ABS(quantity)) AS units_sold_14d
       FROM erp_stock_ledger
       WHERE company_id = $1 AND movement_type = 'issue'
         AND reference_type = 'delivery_note'
         AND movement_date >= CURRENT_DATE - INTERVAL '14 days'
       GROUP BY company_id, item_id, warehouse_id
     ), expiry AS (
       SELECT company_id, item_id, warehouse_id,
              MIN(expiry_date) AS next_expiry_date,
              SUM(quantity) AS tracked_expiry_qty
       FROM erp_stock_ledger
       WHERE company_id = $1 AND expiry_date IS NOT NULL
       GROUP BY company_id, item_id, warehouse_id
     )
     SELECT s.id AS stock_id, i.item_code, i.name AS item_name,
            s.quantity, i.reorder_point, w.name AS warehouse_name,
            expiry.next_expiry_date AS expiry_date,
            COALESCE(expiry.tracked_expiry_qty, 0) AS tracked_expiry_qty,
            COALESCE(sales.units_sold_14d, 0) AS units_sold_14d,
            (COALESCE(expiry.tracked_expiry_qty, 0) <= s.quantity AND NOT EXISTS (
              SELECT 1 FROM erp_stock_ledger legacy_issue
              WHERE legacy_issue.company_id = s.company_id
                AND legacy_issue.item_id = s.item_id
                AND legacy_issue.warehouse_id = s.warehouse_id
                AND legacy_issue.movement_type IN ('issue', 'sale', 'transfer_out')
                AND legacy_issue.expiry_date IS NULL
            )) AS expiry_balance_reconciled
     FROM erp_stock_on_hand s
     JOIN erp_items i ON i.id = s.item_id
     JOIN erp_warehouses w ON w.id = s.warehouse_id
     LEFT JOIN sales ON sales.company_id = s.company_id AND sales.item_id = s.item_id AND sales.warehouse_id = s.warehouse_id
     LEFT JOIN expiry ON expiry.company_id = s.company_id AND expiry.item_id = s.item_id AND expiry.warehouse_id = s.warehouse_id
     WHERE s.company_id = $1 AND s.is_deleted = FALSE
     ORDER BY w.name, i.item_code`,
    [companyId],
  );
  return result.rows;
}

async function analyzeInventory({ companyId, userId = null }) {
  const facts = await collectInventoryFacts(companyId);
  const findings = calculateInventoryFindings(facts);
  const inputHash = crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  const runResult = await pool.query(
    `INSERT INTO erp_ai_analysis_runs (company_id, scenario, provider, model, input_hash, status, started_at, completed_at, created_by)
     VALUES ($1, 'inventory', $2, $3, $4, 'completed', NOW(), NOW(), $5) RETURNING *`,
    [companyId, PROVIDER, MODEL, inputHash, userId],
  );
  const run = runResult.rows[0];

  for (const finding of findings) {
    await pool.query(
      `INSERT INTO erp_ai_findings (
        company_id, analysis_run_id, module, category, severity, confidence,
        entity_type, entity_id, title, finding, recommendation
      ) VALUES ($1,$2,'inventory',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId,
        run.id,
        finding.category,
        finding.severity,
        finding.confidence,
        finding.entityType,
        finding.entityId,
        finding.title,
        finding.finding,
        finding.recommendation,
      ],
    );
  }

  const counts = findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] || 0) + 1;
    return acc;
  }, {});
  const summary = findings.length
    ? `${findings.length} inventory rule ${findings.length === 1 ? "finding" : "findings"}: ${Object.entries(counts).map(([severity, count]) => `${count} ${severity}`).join(", ")}. Review evidence before taking action.`
    : "No stockout or reorder rule findings in the current on-hand snapshot.";
  await pool.query("UPDATE erp_ai_analysis_runs SET summary = $1 WHERE id = $2", [summary, run.id]);

  return { run: { ...run, summary }, facts_count: facts.length, findings };
}

async function listInventoryFindings(companyId, { status = "open", limit = 50 } = {}) {
  const result = await pool.query(
    `SELECT DISTINCT ON (module, category, entity_type, entity_id) * FROM erp_ai_findings
     WHERE company_id = $1 AND ($2 = '' OR status = $2)
     ORDER BY module, category, entity_type, entity_id, created_at DESC
     LIMIT $3`,
    [companyId, status, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return result.rows.sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4));
}

async function reviewInventoryFinding(companyId, findingId, userId, status) {
  if (!["acknowledged", "resolved", "dismissed"].includes(status)) {
    throw new Error("Status must be acknowledged, resolved, or dismissed");
  }
  const result = await pool.query(
     `WITH target AS (
        SELECT module, category, entity_type, entity_id
        FROM erp_ai_findings WHERE company_id = $1 AND id = $2 AND status = 'open'
      )
      UPDATE erp_ai_findings f SET status = $3,
       reviewed_at = NOW(), reviewed_by = $4,
       resolved_at = CASE WHEN $3 IN ('resolved', 'dismissed') THEN NOW() ELSE NULL END,
       resolved_by = CASE WHEN $3 IN ('resolved', 'dismissed') THEN $4 ELSE NULL END
     FROM target t
     WHERE f.company_id = $1 AND f.status = 'open'
       AND f.module = t.module AND f.category = t.category
       AND f.entity_type IS NOT DISTINCT FROM t.entity_type
       AND f.entity_id IS NOT DISTINCT FROM t.entity_id
     RETURNING f.*`,
    [companyId, findingId, status, userId],
  );
  if (!result.rowCount) throw new Error("Open inventory finding not found");
  return result.rows[0];
}

module.exports = {
  calculateInventoryFindings,
  collectInventoryFacts,
  analyzeInventory,
  listInventoryFindings,
  reviewInventoryFinding,
};
