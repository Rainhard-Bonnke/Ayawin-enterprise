-- Cash flow forecast saved report (idempotent)
INSERT INTO erp_saved_reports (company_id, code, name, module, description, query_config, is_system)
SELECT c.id, v.code, v.name, v.module, v.description, v.query_config::jsonb, TRUE
FROM erp_companies c
CROSS JOIN (VALUES
  ('RPT-CASH-FLOW', 'Cash Flow Forecast', 'finance', '4-week AR/AP cash projection', '{"report":"cash_flow_forecast"}')
) AS v(code, name, module, description, query_config)
WHERE NOT EXISTS (
  SELECT 1 FROM erp_saved_reports r WHERE r.company_id = c.id AND r.code = v.code
);
