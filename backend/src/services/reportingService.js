const pool = require("../db");

function kpiStatus(actual, target, warning, critical, higherIsBetter) {
  if (higherIsBetter) {
    if (actual >= target) return "green";
    if (actual >= (warning ?? target * 0.9)) return "amber";
    return "red";
  }
  if (actual <= target) return "green";
  if (actual <= (warning ?? target * 1.1)) return "amber";
  return "red";
}

async function metricRevenueMtd(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0)
       - COALESCE((SELECT SUM(total_amount) FROM erp_customer_credit_notes
                   WHERE company_id = $1 AND status = 'posted' AND credit_date >= date_trunc('month', CURRENT_DATE)),0) AS v
     FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','paid','overdue')
       AND invoice_date >= date_trunc('month', CURRENT_DATE)`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricArOutstanding(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid - credited_amount,0)),0) AS v FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','overdue')`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricApOutstanding(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)), 0) AS v
     FROM erp_supplier_bills
     WHERE company_id = $1 AND status IN ('posted','partial','overdue') AND is_deleted = FALSE`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricStockValue(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(quantity * avg_unit_cost),0) AS v FROM erp_stock_on_hand WHERE company_id = $1`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricHeadcount(companyId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS v FROM erp_employees WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricPayrollMtd(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_gross),0) AS v FROM erp_payroll_runs
     WHERE company_id = $1 AND status = 'posted'
       AND payroll_month >= date_trunc('month', CURRENT_DATE)`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricLeavePending(companyId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS v FROM erp_leave_applications WHERE company_id = $1 AND status = 'pending'`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricOpenPos(companyId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS v FROM erp_purchase_orders WHERE company_id = $1 AND status IN ('approved','sent','partial')`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricOtifStats(companyId) {
  const result = await pool.query(
    `WITH eligible_orders AS (
       SELECT so.id, so.required_date,
              line_totals.ordered_quantity, line_totals.delivered_quantity,
              delivery_dates.last_delivery_date
       FROM erp_sales_orders so
       JOIN LATERAL (
         SELECT COALESCE(SUM(sol.quantity), 0) AS ordered_quantity,
                COALESCE(SUM(sol.qty_delivered), 0) AS delivered_quantity
         FROM erp_sales_order_lines sol
         WHERE sol.sales_order_id = so.id AND sol.company_id = so.company_id AND sol.is_deleted = FALSE
       ) line_totals ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(dn.delivery_date) AS last_delivery_date
         FROM erp_delivery_notes dn
         WHERE dn.sales_order_id = so.id AND dn.company_id = so.company_id
           AND dn.status = 'posted' AND dn.is_deleted = FALSE
       ) delivery_dates ON TRUE
       WHERE so.company_id = $1 AND so.is_deleted = FALSE
         AND so.status NOT IN ('draft','cancelled') AND so.order_date <= CURRENT_DATE
     )
     SELECT COUNT(*)::int AS eligible_order_count,
            COUNT(*) FILTER (WHERE required_date IS NOT NULL)::int AS dated_order_count,
            COUNT(*) FILTER (WHERE required_date <= CURRENT_DATE)::int AS due_order_count,
            COUNT(*) FILTER (
              WHERE required_date <= CURRENT_DATE
                AND ordered_quantity > 0
                AND delivered_quantity >= ordered_quantity
                AND last_delivery_date IS NOT NULL
                AND last_delivery_date <= required_date
            )::int AS on_time_in_full_count
     FROM eligible_orders`,
    [companyId],
  );
  const row = result.rows[0];
  const eligibleOrderCount = Number(row.eligible_order_count || 0);
  const datedOrderCount = Number(row.dated_order_count || 0);
  const dueOrderCount = Number(row.due_order_count || 0);
  const onTimeInFullCount = Number(row.on_time_in_full_count || 0);
  return {
    eligible_order_count: eligibleOrderCount,
    dated_order_count: datedOrderCount,
    due_order_count: dueOrderCount,
    on_time_in_full_count: onTimeInFullCount,
    coverage_percent: eligibleOrderCount
      ? Math.round((datedOrderCount / eligibleOrderCount) * 100)
      : 100,
    otif_percent: dueOrderCount ? Math.round((onTimeInFullCount / dueOrderCount) * 100) : 100,
  };
}

const METRICS = {
  revenue_mtd: metricRevenueMtd,
  ar_outstanding: metricArOutstanding,
  ap_outstanding: metricApOutstanding,
  stock_value: metricStockValue,
  headcount: metricHeadcount,
  payroll_mtd: metricPayrollMtd,
  leave_pending: metricLeavePending,
  open_pos: metricOpenPos,
  dso: async (companyId) => {
    const rev = await metricRevenueMtd(companyId);
    const ar = await metricArOutstanding(companyId);
    if (rev <= 0) return 0;
    return Math.round((ar / rev) * 30);
  },
  inventory_turnover: async (companyId) => {
    const stock = await metricStockValue(companyId);
    const rev = await metricRevenueMtd(companyId);
    if (stock <= 0) return 0;
    return Math.round((rev / stock) * 10) / 10;
  },
  otif: async (companyId) => (await metricOtifStats(companyId)).otif_percent,
  otif_coverage: async (companyId) => (await metricOtifStats(companyId)).coverage_percent,
};

async function getWidgetData(companyId, widgetId) {
  const fn = METRICS[widgetId];
  if (!fn) return { widget: widgetId, value: null, error: "Unknown widget" };
  const value = await fn(companyId);
  return { widget: widgetId, value };
}

async function getDashboard(companyId, code) {
  const dash = await pool.query(
    `SELECT * FROM erp_dashboards WHERE company_id = $1 AND code = $2 AND is_deleted = FALSE`,
    [companyId, code],
  );
  if (!dash.rowCount) return null;

  const layout = dash.rows[0].layout || [];
  const widgets = await Promise.all(layout.map((w) => getWidgetData(companyId, w.widget)));

  return { ...dash.rows[0], widgets };
}

async function computeKpis(companyId) {
  const defs = await pool.query(
    `SELECT * FROM erp_kpi_definitions WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
    [companyId],
  );

  const periodDate = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const kpi of defs.rows) {
    const metric = kpi.calc_config?.metric;
    const fn = METRICS[metric];
    const actual = fn ? await fn(companyId) : 0;
    const status = kpiStatus(
      actual,
      Number(kpi.target_value),
      kpi.warning_threshold != null ? Number(kpi.warning_threshold) : null,
      kpi.critical_threshold != null ? Number(kpi.critical_threshold) : null,
      kpi.higher_is_better,
    );

    await pool.query(
      `INSERT INTO erp_kpi_snapshots (company_id, kpi_id, period_date, actual_value, target_value, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (kpi_id, period_date) DO UPDATE SET actual_value = EXCLUDED.actual_value, status = EXCLUDED.status`,
      [companyId, kpi.id, periodDate, actual, kpi.target_value, status],
    );

    results.push({
      code: kpi.code,
      name: kpi.name,
      module: kpi.module,
      unit: kpi.unit,
      actual,
      target: Number(kpi.target_value),
      status,
      drill_down: kpi.module,
      ...(metric === "otif" ? { coverage: await metricOtifStats(companyId) } : {}),
    });
  }

  return results;
}

async function runStandardReport(companyId, reportKey, filters = {}) {
  switch (reportKey) {
    case "sales_summary": {
      const r = await pool.query(
        `SELECT status, COUNT(*)::int AS order_count, COALESCE(SUM(total_amount),0) AS total
         FROM erp_sales_orders WHERE company_id = $1 AND is_deleted = FALSE GROUP BY status ORDER BY status`,
        [companyId],
      );
      return { report: reportKey, rows: r.rows };
    }
    case "ar_aging": {
      const r = await pool.query(
        `SELECT invoice_no, c.name AS customer, invoice_date, due_date,
                GREATEST(total_amount - amount_paid - credited_amount,0) AS outstanding,
                CASE
                  WHEN due_date >= CURRENT_DATE THEN 'current'
                  WHEN due_date >= CURRENT_DATE - 30 THEN '1-30'
                  WHEN due_date >= CURRENT_DATE - 60 THEN '31-60'
                  ELSE '61+'
                END AS bucket
         FROM erp_customer_invoices inv
         JOIN erp_customers c ON c.id = inv.customer_id
         WHERE inv.company_id = $1 AND inv.status IN ('posted','partial','overdue')
           AND total_amount > amount_paid + credited_amount
         ORDER BY due_date`,
        [companyId],
      );
      return { report: reportKey, rows: r.rows };
    }
    case "stock_valuation": {
      const r = await pool.query(
        `SELECT w.name AS warehouse, i.item_code, i.name AS item, s.quantity, s.avg_unit_cost,
                (s.quantity * s.avg_unit_cost) AS value
         FROM erp_stock_on_hand s
         JOIN erp_items i ON i.id = s.item_id
         JOIN erp_warehouses w ON w.id = s.warehouse_id
         WHERE s.company_id = $1 ORDER BY w.name, i.item_code`,
        [companyId],
      );
      return { report: reportKey, rows: r.rows };
    }
    case "payroll_summary": {
      const r = await pool.query(
        `SELECT pr.run_no, pr.payroll_month, pr.total_gross, pr.total_deductions, pr.total_net, pr.status,
                COUNT(ps.id)::int AS employees
         FROM erp_payroll_runs pr
         LEFT JOIN erp_payslips ps ON ps.payroll_run_id = pr.id
         WHERE pr.company_id = $1 GROUP BY pr.id ORDER BY pr.payroll_month DESC LIMIT 12`,
        [companyId],
      );
      return { report: reportKey, rows: r.rows };
    }
    case "procurement_spend": {
      const r = await pool.query(
        `SELECT v.name AS vendor, COUNT(po.id)::int AS po_count, COALESCE(SUM(po.total_amount),0) AS spend
         FROM erp_purchase_orders po
         JOIN erp_vendors v ON v.id = po.vendor_id
         WHERE po.company_id = $1 AND po.status NOT IN ('cancelled','draft')
         GROUP BY v.id, v.name ORDER BY spend DESC`,
        [companyId],
      );
      return { report: reportKey, rows: r.rows };
    }
    case "ap_aging": {
      const r = await pool.query(
        `SELECT b.bill_no, b.supplier_invoice_no, v.name AS vendor,
                b.bill_date, b.due_date, b.total_amount, b.amount_paid,
                GREATEST(b.total_amount - b.amount_paid, 0) AS outstanding,
                GREATEST(CURRENT_DATE - b.due_date, 0)::int AS days_overdue,
                CASE
                  WHEN b.due_date >= CURRENT_DATE THEN 'current'
                  WHEN b.due_date >= CURRENT_DATE - 30 THEN '1-30'
                  WHEN b.due_date >= CURRENT_DATE - 60 THEN '31-60'
                  WHEN b.due_date >= CURRENT_DATE - 90 THEN '61-90'
                  ELSE '91+'
                END AS bucket
         FROM erp_supplier_bills b
         JOIN erp_vendors v ON v.id = b.vendor_id AND v.company_id = b.company_id
         WHERE b.company_id = $1 AND b.status IN ('posted','partial','overdue')
           AND b.is_deleted = FALSE AND b.total_amount > b.amount_paid
         ORDER BY b.due_date, v.name, b.bill_no`,
        [companyId],
      );
      return { report: reportKey, rows: r.rows };
    }
    default:
      throw new Error(`Unknown report: ${reportKey}`);
  }
}

function rowsToCsv(rows) {
  if (!rows?.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = row[h];
          const s = v == null ? "" : String(v);
          return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

async function getBiDataset(companyId, dataset) {
  const datasets = {
    sales_orders: `SELECT order_no, order_date, status, total_amount, currency_code FROM erp_sales_orders WHERE company_id = $1`,
    customer_invoices: `SELECT invoice_no, invoice_date, due_date, status, subtotal, tax_amount, total_amount FROM erp_customer_invoices WHERE company_id = $1`,
    stock_on_hand: `SELECT i.item_code, w.code AS warehouse, s.quantity, s.avg_unit_cost FROM erp_stock_on_hand s JOIN erp_items i ON i.id = s.item_id JOIN erp_warehouses w ON w.id = s.warehouse_id WHERE s.company_id = $1`,
    payslips: `SELECT e.employee_code, ps.gross_pay, ps.net_pay, ps.paye, ps.nhif, ps.nssf FROM erp_payslips ps JOIN erp_employees e ON e.id = ps.employee_id WHERE ps.company_id = $1`,
    gl_balances: `SELECT a.account_code, a.account_name, b.period_debit, b.period_credit, b.closing_debit, b.closing_credit FROM erp_gl_balances b JOIN erp_chart_of_accounts a ON a.id = b.account_id WHERE b.company_id = $1`,
  };
  const sql = datasets[dataset];
  if (!sql) throw new Error(`Unknown dataset: ${dataset}`);
  const r = await pool.query(sql, [companyId]);
  return { dataset, rows: r.rows, count: r.rowCount };
}

module.exports = {
  getDashboard,
  getWidgetData,
  computeKpis,
  runStandardReport,
  rowsToCsv,
  getBiDataset,
  kpiStatus,
  METRICS,
};
