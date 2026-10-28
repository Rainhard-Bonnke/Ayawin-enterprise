const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const reporting = require("../../services/reportingService");
const inventory = require("../../services/inventoryService");

const router = express.Router();
router.use(authenticateErp);

router.get("/library", requirePermission("reports.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, module, description, is_system FROM erp_saved_reports
     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE ORDER BY module, name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/run/:code", requirePermission("reports.view"), async (req, res) => {
  const saved = await pool.query(
    `SELECT * FROM erp_saved_reports WHERE company_id = $1 AND code = $2 AND is_deleted = FALSE`,
    [req.user.company_id, req.params.code],
  );
  if (!saved.rowCount) return res.status(404).json({ error: "Report not found" });

  const reportKey = saved.rows[0].query_config?.report || req.params.code;
  try {
    const data = await reporting.runStandardReport(req.user.company_id, reportKey, req.query);
    const format = req.query.format || "json";
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.code}.csv"`);
      return res.send(reporting.rowsToCsv(data.rows));
    }
    return res.json(data);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/dashboards", requirePermission("reports.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT code, name, audience FROM erp_dashboards
     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE ORDER BY name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/dashboards/:code", requirePermission("reports.view"), async (req, res) => {
  const dash = await reporting.getDashboard(req.user.company_id, req.params.code);
  if (!dash) return res.status(404).json({ error: "Dashboard not found" });
  return res.json(dash);
});

router.get("/kpis", requirePermission("reports.view"), async (req, res) => {
  const kpis = await reporting.computeKpis(req.user.company_id);
  return res.json(kpis);
});

router.get("/dashboard/summary", requirePermission("reports.view"), async (req, res) => {
  const companyId = req.user.company_id;
  const [kpis, monthly, products, categories, transactions, reorder] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE((SELECT SUM(total_amount) FROM erp_customer_invoices WHERE company_id = $1 AND is_deleted = FALSE AND status IN ('posted','partial','paid','overdue','credited') AND invoice_date = CURRENT_DATE),0)
           - COALESCE((SELECT SUM(total_amount) FROM erp_customer_credit_notes WHERE company_id = $1 AND status = 'posted' AND credit_date = CURRENT_DATE),0) AS todays_sales,
         COALESCE((SELECT SUM(total_amount) FROM erp_customer_invoices WHERE company_id = $1 AND is_deleted = FALSE AND status IN ('posted','partial','paid','overdue','credited') AND invoice_date >= date_trunc('month', CURRENT_DATE)),0)
           - COALESCE((SELECT SUM(total_amount) FROM erp_customer_credit_notes WHERE company_id = $1 AND status = 'posted' AND credit_date >= date_trunc('month', CURRENT_DATE)),0) AS revenue_mtd,
         (SELECT COUNT(*)::int FROM erp_sales_orders WHERE company_id = $1 AND is_deleted = FALSE AND status IN ('draft','confirmed','partial')) AS pending_orders,
         COALESCE((SELECT SUM(GREATEST(total_amount - amount_paid - credited_amount,0)) FROM erp_customer_invoices WHERE company_id = $1 AND is_deleted = FALSE AND status IN ('posted','partial','overdue')),0) AS outstanding_invoices`, [companyId]),
    pool.query(
      `SELECT TO_CHAR(month_start, 'Mon') AS month,
         COALESCE(SUM(i.total_amount),0) - COALESCE((
           SELECT SUM(n.total_amount) FROM erp_customer_credit_notes n
           WHERE n.company_id = $1 AND n.status = 'posted'
             AND n.credit_date >= month_start AND n.credit_date < month_start + INTERVAL '1 month'),0) AS revenue
       FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS months(month_start)
       LEFT JOIN erp_customer_invoices i ON i.company_id = $1 AND i.is_deleted = FALSE AND i.status IN ('posted','partial','paid','overdue','credited') AND i.invoice_date >= month_start AND i.invoice_date < month_start + INTERVAL '1 month'
       GROUP BY month_start ORDER BY month_start`, [companyId]),
    pool.query(
      `SELECT i.name, SUM(il.quantity) AS units FROM erp_customer_invoice_lines il JOIN erp_customer_invoices inv ON inv.id = il.invoice_id JOIN erp_items i ON i.id = il.item_id WHERE il.company_id = $1 AND il.is_deleted = FALSE AND inv.is_deleted = FALSE AND inv.status IN ('posted','partial','paid','overdue') GROUP BY i.id, i.name ORDER BY units DESC LIMIT 6`, [companyId]),
    pool.query(
      `SELECT COALESCE(cat.name,'Uncategorized') AS name, SUM(il.line_total) AS value FROM erp_customer_invoice_lines il JOIN erp_customer_invoices inv ON inv.id = il.invoice_id JOIN erp_items i ON i.id = il.item_id LEFT JOIN erp_item_categories cat ON cat.id = i.category_id WHERE il.company_id = $1 AND il.is_deleted = FALSE AND inv.is_deleted = FALSE AND inv.status IN ('posted','partial','paid','overdue') AND inv.invoice_date >= date_trunc('month', CURRENT_DATE) GROUP BY cat.name ORDER BY value DESC LIMIT 6`, [companyId]),
    pool.query(
      `SELECT inv.invoice_no AS id, inv.invoice_date AS date, c.name AS customer, inv.total_amount AS total, inv.status FROM erp_customer_invoices inv JOIN erp_customers c ON c.id = inv.customer_id WHERE inv.company_id = $1 AND inv.is_deleted = FALSE ORDER BY inv.invoice_date DESC, inv.created_at DESC LIMIT 8`, [companyId]),
    inventory.getReorderAlerts(companyId, 8),
  ]);
  const alerts = (reorder || []).map((row) => ({ type: "stock", severity: "warning", message: `Low stock: ${row.item_name} (${row.warehouse_name})` }));
  return res.json({
    kpis: Object.fromEntries(Object.entries(kpis.rows[0]).map(([key, value]) => [key, Number(value || 0)])),
    monthlyRevenue: monthly.rows.map((row) => ({ month: row.month, revenue: Number(row.revenue || 0) })),
    topProducts: products.rows.map((row) => ({ name: row.name, units: Number(row.units || 0) })),
    salesByCategory: categories.rows.map((row) => ({ name: row.name, value: Number(row.value || 0) })),
    alerts,
    recentTransactions: transactions.rows.map((row) => ({ id: row.id, date: row.date, customer: row.customer, rep: "", total: Number(row.total || 0), status: row.status })),
  });
});

router.get("/kpis/:code/drill-down", requirePermission("reports.view"), async (req, res) => {
  const kpi = await pool.query(
    `SELECT * FROM erp_kpi_definitions WHERE company_id = $1 AND code = $2`,
    [req.user.company_id, req.params.code],
  );
  if (!kpi.rowCount) return res.status(404).json({ error: "KPI not found" });

  const module = kpi.rows[0].module;
  const drillMap = {
    sales: "RPT-SALES-SUMMARY",
    finance: "RPT-AR-AGING",
    inventory: "RPT-STOCK-VAL",
    hr: "RPT-PAYROLL-SUM",
    procurement: "RPT-PROC-SPEND",
  };
  const reportCode = drillMap[module] || "RPT-SALES-SUMMARY";
  const saved = await pool.query(
    `SELECT query_config FROM erp_saved_reports WHERE company_id = $1 AND code = $2`,
    [req.user.company_id, reportCode],
  );
  const reportKey = saved.rows[0]?.query_config?.report;
  const data = await reporting.runStandardReport(req.user.company_id, reportKey);
  return res.json({ kpi: req.params.code, module, report: reportCode, ...data });
});

router.get("/bi/:dataset", requirePermission("reports.export"), async (req, res) => {
  try {
    const data = await reporting.getBiDataset(req.user.company_id, req.params.dataset);
    const format = req.query.format || "json";
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.dataset}.csv"`);
      return res.send(reporting.rowsToCsv(data.rows));
    }
    return res.json(data);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/schedules", requirePermission("reports.export"), async (req, res) => {
  const { saved_report_id, cron_expression, recipients, format } = req.body || {};
  if (!saved_report_id) return res.status(400).json({ error: "saved_report_id required" });
  const result = await pool.query(
    `INSERT INTO erp_report_schedules (company_id, saved_report_id, cron_expression, recipients, format, created_by)
     VALUES ($1,$2,COALESCE($3,'0 8 1 * *'),$4,COALESCE($5,'csv'),$6) RETURNING *`,
    [req.user.company_id, saved_report_id, cron_expression, recipients || [], format, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

module.exports = router;
