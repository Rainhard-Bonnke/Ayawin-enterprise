const pool = require('../db');
const { syncOverdueInvoices } = require('./overdueService');
const reporting = require('./reportingService');
const { fillMonthlyRevenueGaps, parseDashboardRange } = require('../lib/chartMonths');

const overdueSyncAt = new Map();
const OVERDUE_SYNC_INTERVAL_MS = Number(process.env.DASHBOARD_OVERDUE_SYNC_MS) || 5 * 60 * 1000;

function overdueSyncForDashboard(companyId) {
  const last = overdueSyncAt.get(companyId) || 0;
  if (Date.now() - last < OVERDUE_SYNC_INTERVAL_MS) return Promise.resolve();
  return syncOverdueInvoices(companyId).then(() => {
    overdueSyncAt.set(companyId, Date.now());
  });
}

async function getDashboardSummary(companyId, query = {}) {
  const range = parseDashboardRange(query);
  const { from, to } = range;
  const today = new Date().toISOString().slice(0, 10);

  const [
    _overdueSync,
    revenueInRange,
    revenueMtd,
    arOutstanding,
    stockValue,
    openPos,
    todaysSales,
    pendingOrders,
    pipeline,
    monthlyRev,
    topProducts,
    byCategory,
    recentOrders,
    stockAlerts,
    overdueInvoices,
    kpiDefs,
  ] = await Promise.all([
    overdueSyncForDashboard(companyId),
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM erp_customer_invoices
       WHERE company_id = $1 AND invoice_date BETWEEN $2 AND $3
         AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM erp_customer_invoices
       WHERE company_id = $1 AND invoice_date >= date_trunc('month', CURRENT_DATE)::date
         AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE`,
      [companyId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(total_amount - amount_paid),0) AS total FROM erp_customer_invoices
       WHERE company_id = $1 AND status IN ('posted','partial','overdue') AND is_deleted = FALSE`,
      [companyId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(quantity * avg_unit_cost),0) AS total FROM erp_stock_on_hand WHERE company_id = $1`,
      [companyId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM erp_purchase_orders
       WHERE company_id = $1 AND status IN ('approved','sent','partial') AND is_deleted = FALSE`,
      [companyId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM erp_customer_invoices
       WHERE company_id = $1 AND invoice_date = $2
         AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE`,
      [companyId, today],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM erp_sales_orders
       WHERE company_id = $1 AND is_deleted = FALSE
         AND status NOT IN ('delivered','invoiced','cancelled','closed')`,
      [companyId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount * probability / 100),0) AS forecast FROM erp_opportunities
       WHERE company_id = $1 AND is_deleted = FALSE AND stage NOT IN ('won','lost')`,
      [companyId],
    ),
    pool.query(
      `SELECT to_char(date_trunc('month', invoice_date), 'Mon YY') AS month,
              date_trunc('month', invoice_date) AS sort_key,
              COALESCE(SUM(total_amount),0) AS revenue
       FROM erp_customer_invoices
       WHERE company_id = $1 AND invoice_date BETWEEN $2 AND $3
         AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE
       GROUP BY 1, 2 ORDER BY sort_key`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT i.name AS item_name, SUM(il.quantity)::float AS units
       FROM erp_customer_invoice_lines il
       JOIN erp_items i ON i.id = il.item_id
       JOIN erp_customer_invoices inv ON inv.id = il.invoice_id
       WHERE inv.company_id = $1 AND inv.invoice_date BETWEEN $2 AND $3
         AND inv.is_deleted = FALSE AND il.is_deleted = FALSE
       GROUP BY i.name ORDER BY units DESC LIMIT 8`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT COALESCE(ic.name, 'Uncategorized') AS category,
              COALESCE(SUM(il.line_total),0)::float AS value
       FROM erp_customer_invoice_lines il
       JOIN erp_items i ON i.id = il.item_id
       LEFT JOIN erp_item_categories ic ON ic.id = i.category_id
       JOIN erp_customer_invoices inv ON inv.id = il.invoice_id
       WHERE inv.company_id = $1 AND inv.invoice_date BETWEEN $2 AND $3
         AND inv.is_deleted = FALSE AND il.is_deleted = FALSE
       GROUP BY ic.name ORDER BY value DESC LIMIT 6`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT so.id, so.order_no, so.order_date, c.name AS customer_name,
              so.total_amount, so.status
       FROM erp_sales_orders so
       JOIN erp_customers c ON c.id = so.customer_id
       WHERE so.company_id = $1 AND so.is_deleted = FALSE
       ORDER BY so.order_date DESC, so.created_at DESC LIMIT 8`,
      [companyId],
    ),
    pool.query(
      `SELECT s.item_id, s.warehouse_id, i.item_code, i.name AS item_name,
              s.quantity, i.reorder_point, w.name AS warehouse_name
       FROM erp_stock_on_hand s
       JOIN erp_items i ON i.id = s.item_id
       JOIN erp_warehouses w ON w.id = s.warehouse_id
       WHERE s.company_id = $1 AND i.reorder_point > 0 AND s.quantity <= i.reorder_point
       ORDER BY s.quantity ASC LIMIT 20`,
      [companyId],
    ),
    pool.query(
      `SELECT id, invoice_no, customer_id, total_amount - amount_paid AS outstanding, due_date
       FROM erp_customer_invoices
       WHERE company_id = $1 AND status = 'overdue' AND is_deleted = FALSE
       ORDER BY due_date ASC LIMIT 20`,
      [companyId],
    ),
    reporting.computeKpis(companyId),
  ]);

  const monthlyRevenue = fillMonthlyRevenueGaps(
    monthlyRev.rows.map((r) => ({
      month: r.month,
      sort_key: r.sort_key,
      revenue: Number(r.revenue || 0),
    })),
    from,
    to,
  );

  const alerts = [
    ...stockAlerts.rows.map((r) => ({
      type: 'stock',
      severity: Number(r.quantity) <= 0 ? 'high' : 'warning',
      message: `Low stock: ${r.item_name} (${r.warehouse_name}) — ${Number(r.quantity)} on hand`,
      item_id: r.item_id,
      warehouse_id: r.warehouse_id,
      item_code: r.item_code,
      href: `/inventory?q=${encodeURIComponent(r.item_code || r.item_name)}`,
    })),
    ...overdueInvoices.rows.map((r) => ({
      type: 'invoice',
      severity: 'high',
      message: `Overdue: ${r.invoice_no} — ${Number(r.outstanding).toLocaleString('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })}`,
      invoice_id: r.id,
      invoice_no: r.invoice_no,
      href: `/invoices?q=${encodeURIComponent(r.invoice_no)}`,
    })),
  ];

  return {
    range: { from, to, preset: query.preset || null },
    kpis: {
      todays_sales: Number(todaysSales.rows[0]?.total || 0),
      revenue_mtd: Number(revenueMtd.rows[0]?.total || 0),
      revenue_in_range: Number(revenueInRange.rows[0]?.total || 0),
      pending_orders: Number(pendingOrders.rows[0]?.count || 0),
      outstanding_invoices: Number(arOutstanding.rows[0]?.total || 0),
      pipeline_forecast: Number(pipeline.rows[0]?.forecast || 0),
      stock_value: Number(stockValue.rows[0]?.total || 0),
      open_pos: Number(openPos.rows[0]?.total || 0),
    },
    monthlyRevenue,
    topProducts: topProducts.rows.map((r) => ({
      name: r.item_name,
      units: Number(r.units || 0),
    })),
    salesByCategory: byCategory.rows.map((r) => ({
      name: r.category,
      value: Number(r.value || 0),
    })),
    recentTransactions: recentOrders.rows.map((r) => ({
      id: r.order_no,
      internal_id: r.id,
      date: String(r.order_date || '').slice(0, 10),
      customer: r.customer_name,
      rep: '—',
      total: Number(r.total_amount || 0),
      status: r.status,
    })),
    alerts,
    kpiDefinitions: kpiDefs,
  };
}

module.exports = { getDashboardSummary };
