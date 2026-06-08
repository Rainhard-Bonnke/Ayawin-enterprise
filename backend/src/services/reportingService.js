const pool = require('../db');
const { parseReportRange } = require('../lib/reportDateRange');
const reportExport = require('./reportExportService');

function kpiStatus(actual, target, warning, critical, higherIsBetter) {
  if (higherIsBetter) {
    if (actual >= target) return 'green';
    if (actual >= (warning ?? target * 0.9)) return 'amber';
    return 'red';
  }
  if (actual <= target) return 'green';
  if (actual <= (warning ?? target * 1.1)) return 'amber';
  return 'red';
}

async function metricRevenueMtd(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS v FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','paid','overdue')
       AND invoice_date >= date_trunc('month', CURRENT_DATE)`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricRevenueInRange(companyId, from, to) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS v FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE
       AND invoice_date BETWEEN $2 AND $3`,
    [companyId, from, to],
  );
  return Number(r.rows[0].v);
}

async function metricArOutstanding(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_amount - amount_paid),0) AS v FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','overdue')`,
    [companyId],
  );
  return Number(r.rows[0].v);
}

async function metricApOutstanding(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_amount - amount_paid),0) AS v FROM erp_vendor_invoices
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
  otif: async (companyId) => {
    const r = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('posted','delivered'))::float AS ok,
              NULLIF(COUNT(*),0)::float AS total
       FROM erp_delivery_notes WHERE company_id = $1`,
      [companyId],
    );
    const row = r.rows[0];
    return row.total ? Math.round((row.ok / row.total) * 100) : 100;
  },
};

async function getWidgetData(companyId, widgetId) {
  const fn = METRICS[widgetId];
  if (!fn) return { widget: widgetId, value: null, error: 'Unknown widget' };
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
  const widgets = await Promise.all(
    layout.map((w) => getWidgetData(companyId, w.widget)),
  );

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
    });
  }

  return results;
}

async function reconcileWithDashboard(companyId, filters = {}) {
  const range = parseReportRange(filters);
  const dashboardService = require('./dashboardService');
  const summary = await dashboardService.getDashboardSummary(companyId, {
    from: range.from,
    to: range.to,
    preset: filters.preset,
  });

  const checks = [
    {
      metric: 'revenue_in_range',
      dashboard: Number(summary.kpis.revenue_in_range || 0),
      report: await metricRevenueInRange(companyId, range.from, range.to),
    },
    {
      metric: 'revenue_mtd',
      dashboard: Number(summary.kpis.revenue_mtd || 0),
      report: await metricRevenueMtd(companyId),
    },
    {
      metric: 'outstanding_invoices',
      dashboard: Number(summary.kpis.outstanding_invoices || 0),
      report: await metricArOutstanding(companyId),
    },
    {
      metric: 'stock_value',
      dashboard: Number(summary.kpis.stock_value || 0),
      report: await metricStockValue(companyId),
    },
    {
      metric: 'open_pos',
      dashboard: Number(summary.kpis.open_pos || 0),
      report: await metricOpenPos(companyId),
    },
  ];

  const rows = checks.map((c) => {
    const variance = Math.round((c.report - c.dashboard) * 100) / 100;
    return {
      ...c,
      variance,
      matched: Math.abs(variance) < 1,
    };
  });

  return {
    report: 'kpi_reconciliation',
    period: range,
    rows,
    all_matched: rows.every((r) => r.matched),
  };
}

async function runStandardReport(companyId, reportKey, filters = {}) {
  const range = parseReportRange(filters);

  switch (reportKey) {
    case 'kpi_reconciliation':
      return reconcileWithDashboard(companyId, filters);

    case 'comparative_period': {
      const current = await metricRevenueInRange(companyId, range.from, range.to);
      let prior = 0;
      if (range.compare) {
        prior = await metricRevenueInRange(companyId, range.compare.from, range.compare.to);
      }
      const change = prior > 0 ? Math.round(((current - prior) / prior) * 10000) / 100 : null;
      return {
        report: reportKey,
        period: range,
        rows: [
          {
            metric: 'revenue',
            current_from: range.from,
            current_to: range.to,
            current_value: current,
            prior_from: range.compare?.from || null,
            prior_to: range.compare?.to || null,
            prior_value: prior,
            change_percent: change,
          },
        ],
      };
    }

    case 'sales_summary': {
      const r = await pool.query(
        `SELECT status, COUNT(*)::int AS order_count, COALESCE(SUM(total_amount),0) AS total
         FROM erp_sales_orders
         WHERE company_id = $1 AND is_deleted = FALSE
           AND order_date BETWEEN $2 AND $3
         GROUP BY status ORDER BY status`,
        [companyId, range.from, range.to],
      );
      return { report: reportKey, period: range, rows: r.rows };
    }
    case 'ar_aging': {
      const data = await require('./crmService').getArAging(companyId);
      const filtered = data.rows.filter((row) => {
        const d = String(row.invoice_date || '').slice(0, 10);
        return d >= range.from && d <= range.to;
      });
      return { report: reportKey, period: range, rows: filtered.slice(0, range.limit), summary: data.summary };
    }
    case 'stock_valuation': {
      const r = await pool.query(
        `SELECT w.name AS warehouse, i.item_code, i.name AS item, s.quantity, s.avg_unit_cost,
                (s.quantity * s.avg_unit_cost) AS value
         FROM erp_stock_on_hand s
         JOIN erp_items i ON i.id = s.item_id
         JOIN erp_warehouses w ON w.id = s.warehouse_id
         WHERE s.company_id = $1 ORDER BY w.name, i.item_code`,
        [companyId],
      );
      return { report: reportKey, period: range, rows: r.rows.slice(0, range.limit) };
    }
    case 'payroll_summary': {
      const r = await pool.query(
        `SELECT pr.run_no, pr.payroll_month, pr.total_gross, pr.total_deductions, pr.total_net, pr.status,
                COUNT(ps.id)::int AS employees
         FROM erp_payroll_runs pr
         LEFT JOIN erp_payslips ps ON ps.payroll_run_id = pr.id
         WHERE pr.company_id = $1 AND pr.payroll_month BETWEEN $2::date AND $3::date
         GROUP BY pr.id ORDER BY pr.payroll_month DESC LIMIT $4`,
        [companyId, range.from, range.to, range.limit],
      );
      return { report: reportKey, period: range, rows: r.rows };
    }
    case 'procurement_spend': {
      const r = await pool.query(
        `SELECT v.name AS vendor, COUNT(po.id)::int AS po_count, COALESCE(SUM(po.total_amount),0) AS spend
         FROM erp_purchase_orders po
         JOIN erp_vendors v ON v.id = po.vendor_id
         WHERE po.company_id = $1 AND po.status NOT IN ('cancelled','draft') AND po.is_deleted = FALSE
           AND po.order_date BETWEEN $2 AND $3
         GROUP BY v.id, v.name ORDER BY spend DESC LIMIT $4`,
        [companyId, range.from, range.to, range.limit],
      );
      return { report: reportKey, period: range, rows: r.rows };
    }
    case 'ap_aging': {
      const r = await pool.query(
        `SELECT vb.bill_no, v.name AS vendor, vb.bill_date, vb.due_date,
                vb.total_amount - vb.amount_paid AS outstanding, vb.status, vb.match_status,
                CASE
                  WHEN COALESCE(vb.due_date, vb.bill_date) >= CURRENT_DATE - 30 THEN 'current'
                  WHEN COALESCE(vb.due_date, vb.bill_date) >= CURRENT_DATE - 60 THEN '31-60'
                  WHEN COALESCE(vb.due_date, vb.bill_date) >= CURRENT_DATE - 90 THEN '61-90'
                  ELSE '90+'
                END AS bucket
         FROM erp_vendor_invoices vb
         JOIN erp_vendors v ON v.id = vb.vendor_id
         WHERE vb.company_id = $1 AND vb.status IN ('posted','partial','overdue')
           AND vb.total_amount > vb.amount_paid AND vb.is_deleted = FALSE
           AND vb.bill_date BETWEEN $2 AND $3
         ORDER BY vb.bill_date LIMIT $4`,
        [companyId, range.from, range.to, range.limit],
      );
      return { report: reportKey, period: range, rows: r.rows };
    }
    case 'cash_flow_forecast': {
      const ar = await pool.query(
        `SELECT due_date, total_amount - amount_paid AS outstanding
         FROM erp_customer_invoices
         WHERE company_id = $1 AND status IN ('posted','partial','overdue')
           AND total_amount > amount_paid`,
        [companyId],
      );
      const ap = await pool.query(
        `SELECT due_date, total_amount - amount_paid AS outstanding
         FROM erp_vendor_invoices
         WHERE company_id = $1 AND status IN ('posted','partial','overdue')
           AND total_amount > amount_paid AND is_deleted = FALSE`,
        [companyId],
      );
      const weeks = [0, 0, 0, 0];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (const row of ar.rows) {
        const due = new Date(row.due_date);
        const days = Math.ceil((due - today) / 86400000);
        const wi = Math.min(3, Math.max(0, Math.floor(days / 7)));
        weeks[wi] += Number(row.outstanding || 0);
      }
      for (const row of ap.rows) {
        const due = new Date(row.due_date || row.bill_date);
        const days = Math.ceil((due - today) / 86400000);
        const wi = Math.min(3, Math.max(0, Math.floor(days / 7)));
        weeks[wi] -= Number(row.outstanding || 0);
      }
      return {
        report: reportKey,
        period: range,
        rows: weeks.map((value, i) => ({ label: `Week ${i + 1}`, value: Math.round(value) })),
      };
    }
    default:
      throw new Error(`Unknown report: ${reportKey}`);
  }
}

function rowsToCsv(rows) {
  return reportExport.rowsToCsv(rows, { bom: true });
}

async function getBiDataset(companyId, dataset, filters = {}) {
  const range = parseReportRange(filters);
  const datasets = {
    sales_orders: {
      sql: `SELECT order_no, order_date, status, total_amount, currency_code FROM erp_sales_orders
            WHERE company_id = $1 AND is_deleted = FALSE AND order_date BETWEEN $2 AND $3 ORDER BY order_date DESC LIMIT $4`,
      params: [companyId, range.from, range.to, range.limit],
    },
    customer_invoices: {
      sql: `SELECT invoice_no, invoice_date, due_date, status, subtotal, tax_amount, total_amount
            FROM erp_customer_invoices
            WHERE company_id = $1 AND is_deleted = FALSE AND invoice_date BETWEEN $2 AND $3
            ORDER BY invoice_date DESC LIMIT $4`,
      params: [companyId, range.from, range.to, range.limit],
    },
    stock_on_hand: {
      sql: `SELECT i.item_code, w.code AS warehouse, s.quantity, s.avg_unit_cost
            FROM erp_stock_on_hand s JOIN erp_items i ON i.id = s.item_id
            JOIN erp_warehouses w ON w.id = s.warehouse_id WHERE s.company_id = $1 LIMIT $2`,
      params: [companyId, range.limit],
    },
    payslips: {
      sql: `SELECT e.employee_code, ps.gross_pay, ps.net_pay, ps.paye, ps.nhif, ps.nssf
            FROM erp_payslips ps JOIN erp_employees e ON e.id = ps.employee_id
            WHERE ps.company_id = $1 LIMIT $2`,
      params: [companyId, range.limit],
    },
    gl_balances: {
      sql: `SELECT a.account_code, a.account_name, b.period_debit, b.period_credit, b.closing_debit, b.closing_credit
            FROM erp_gl_balances b JOIN erp_chart_of_accounts a ON a.id = b.account_id
            WHERE b.company_id = $1 LIMIT $2`,
      params: [companyId, range.limit],
    },
  };
  const spec = datasets[dataset];
  if (!spec) throw new Error(`Unknown dataset: ${dataset}`);
  const r = await pool.query(spec.sql, spec.params);
  return { dataset, period: range, rows: r.rows, count: r.rowCount };
}

module.exports = {
  getDashboard,
  getWidgetData,
  computeKpis,
  runStandardReport,
  reconcileWithDashboard,
  rowsToCsv,
  getBiDataset,
  kpiStatus,
  METRICS,
  metricRevenueInRange,
};
