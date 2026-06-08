const express = require('express');

const pool = require('../../db');

const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');

const reporting = require('../../services/reportingService');

const reportExport = require('../../services/reportExportService');

const dashboardService = require('../../services/dashboardService');



const router = express.Router();

router.use(authenticateErp);

/** Large exports (up to 50k rows) — extend socket timeout for CSV/XLSX/PDF. */
router.use((req, res, next) => {
  const fmt = String(req.query.format || '').toLowerCase();
  if (['csv', 'xlsx', 'pdf'].includes(fmt)) {
    req.setTimeout(300000);
    res.setTimeout(300000);
  }
  next();
});



router.get('/dashboard/summary', requirePermission('reports.view'), async (req, res) => {

  try {

    const summary = await dashboardService.getDashboardSummary(req.user.company_id, req.query);

    return res.json(summary);

  } catch (err) {

    console.error(err);

    return res.status(500).json({ error: 'Unable to load dashboard summary' });

  }

});



router.get('/library', requirePermission('reports.view'), async (req, res) => {

  const result = await pool.query(

    `SELECT id, code, name, module, description, is_system FROM erp_saved_reports

     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE ORDER BY module, name`,

    [req.user.company_id],

  );

  return res.json(result.rows);

});



router.get('/reconcile-kpis', requirePermission('reports.view'), async (req, res) => {

  try {

    const data = await reporting.reconcileWithDashboard(req.user.company_id, req.query);

    return res.json(data);

  } catch (err) {

    return res.status(400).json({ error: err.message });

  }

});



router.get('/run/:code', requirePermission('reports.view'), async (req, res) => {

  const saved = await pool.query(

    `SELECT * FROM erp_saved_reports WHERE company_id = $1 AND code = $2 AND is_deleted = FALSE`,

    [req.user.company_id, req.params.code],

  );

  if (!saved.rowCount) return res.status(404).json({ error: 'Report not found' });



  const reportKey = saved.rows[0].query_config?.report || req.params.code;

  try {

    const data = await reporting.runStandardReport(req.user.company_id, reportKey, req.query);

    const format = String(req.query.format || 'json').toLowerCase();

    const title = saved.rows[0].name || req.params.code;

    const periodLabel = data.period ? `${data.period.from} → ${data.period.to}` : '';



    if (format === 'csv') {

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');

      res.setHeader('Content-Disposition', `attachment; filename="${req.params.code}.csv"`);

      return res.send(reporting.rowsToCsv(data.rows));

    }

    if (format === 'xlsx') {

      const buffer = reportExport.rowsToXlsxBuffer(data.rows, title);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      res.setHeader('Content-Disposition', `attachment; filename="${req.params.code}.xlsx"`);

      return res.send(buffer);

    }

    if (format === 'pdf') {

      const co = await pool.query('SELECT name FROM erp_companies WHERE id = $1', [req.user.company_id]);

      const buffer = await reportExport.renderReportPdfBuffer({

        title,

        subtitle: saved.rows[0].description,

        rows: data.rows,

        meta: {
          period: periodLabel,
          generated_at: new Date().toISOString().slice(0, 19),
          company_name: co.rows[0]?.name || 'Ayawin Stock Solutions ERP',
        },

      });

      res.setHeader('Content-Type', 'application/pdf');

      res.setHeader('Content-Disposition', `attachment; filename="${req.params.code}.pdf"`);

      return res.send(buffer);

    }

    return res.json(data);

  } catch (err) {

    return res.status(400).json({ error: err.message });

  }

});



router.get('/dashboards', requirePermission('reports.view'), async (req, res) => {

  const result = await pool.query(

    `SELECT code, name, audience FROM erp_dashboards

     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE ORDER BY name`,

    [req.user.company_id],

  );

  return res.json(result.rows);

});



router.get('/dashboards/:code', requirePermission('reports.view'), async (req, res) => {

  const dash = await reporting.getDashboard(req.user.company_id, req.params.code);

  if (!dash) return res.status(404).json({ error: 'Dashboard not found' });

  return res.json(dash);

});



router.get('/kpis', requirePermission('reports.view'), async (req, res) => {

  const kpis = await reporting.computeKpis(req.user.company_id);

  return res.json(kpis);

});



router.get('/kpis/:code/drill-down', requirePermission('reports.view'), async (req, res) => {

  const kpi = await pool.query(

    `SELECT * FROM erp_kpi_definitions WHERE company_id = $1 AND code = $2`,

    [req.user.company_id, req.params.code],

  );

  if (!kpi.rowCount) return res.status(404).json({ error: 'KPI not found' });



  const module = kpi.rows[0].module;

  const drillMap = {

    sales: 'RPT-SALES-SUMMARY',

    finance: 'RPT-AR-AGING',

    inventory: 'RPT-STOCK-VAL',

    hr: 'RPT-PAYROLL-SUM',

    procurement: 'RPT-PROC-SPEND',

  };

  const reportCode = drillMap[module] || 'RPT-SALES-SUMMARY';

  const saved = await pool.query(

    `SELECT query_config FROM erp_saved_reports WHERE company_id = $1 AND code = $2`,

    [req.user.company_id, reportCode],

  );

  const reportKey = saved.rows[0]?.query_config?.report;

  const data = await reporting.runStandardReport(req.user.company_id, reportKey, req.query);

  return res.json({ kpi: req.params.code, module, report: reportCode, ...data });

});



router.get('/bi/:dataset', requirePermission('reports.export'), async (req, res) => {

  try {

    const data = await reporting.getBiDataset(req.user.company_id, req.params.dataset, req.query);

    const format = String(req.query.format || 'json').toLowerCase();

    if (format === 'csv') {

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');

      res.setHeader('Content-Disposition', `attachment; filename="${req.params.dataset}.csv"`);

      return res.send(reporting.rowsToCsv(data.rows));

    }

    if (format === 'xlsx') {

      const buffer = reportExport.rowsToXlsxBuffer(data.rows, req.params.dataset);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      res.setHeader('Content-Disposition', `attachment; filename="${req.params.dataset}.xlsx"`);

      return res.send(buffer);

    }

    return res.json(data);

  } catch (err) {

    return res.status(400).json({ error: err.message });

  }

});



router.post('/schedules', requirePermission('reports.export'), async (req, res) => {

  const { saved_report_id, cron_expression, recipients, format } = req.body || {};

  if (!saved_report_id) return res.status(400).json({ error: 'saved_report_id required' });

  const result = await pool.query(

    `INSERT INTO erp_report_schedules (company_id, saved_report_id, cron_expression, recipients, format, created_by)

     VALUES ($1,$2,COALESCE($3,'0 8 1 * *'),$4,COALESCE($5,'csv'),$6) RETURNING *`,

    [req.user.company_id, saved_report_id, cron_expression, recipients || [], format, req.user.id],

  );

  return res.status(201).json(result.rows[0]);

});



module.exports = router;


