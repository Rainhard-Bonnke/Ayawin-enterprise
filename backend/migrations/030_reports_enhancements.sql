-- Additional standard reports: KPI reconciliation & comparative period

INSERT INTO erp_saved_reports (company_id, code, name, module, description, query_config, is_system)
SELECT c.id, v.code, v.name, v.mod, v.descr, v.cfg::jsonb, TRUE
FROM erp_companies c
CROSS JOIN (VALUES
  ('RPT-KPI-RECON', 'KPI vs Dashboard', 'reports', 'Verify report totals match dashboard KPIs', '{"report":"kpi_reconciliation"}'),
  ('RPT-COMPARE', 'Comparative Revenue', 'sales', 'Current vs prior period revenue', '{"report":"comparative_period"}')
) AS v(code, name, mod, descr, cfg)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_saved_reports r WHERE r.company_id = c.id AND r.code = v.code);
