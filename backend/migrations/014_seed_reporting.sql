-- Module 7 seed: dashboards, KPIs, standard reports

INSERT INTO erp_saved_reports (company_id, code, name, module, description, query_config, is_system)
SELECT c.id, v.code, v.name, v.mod, v.descr, v.cfg::jsonb, TRUE
FROM erp_companies c
CROSS JOIN (VALUES
  ('RPT-SALES-SUMMARY', 'Sales Summary', 'sales', 'Revenue and orders by status', '{"report":"sales_summary"}'),
  ('RPT-AR-AGING', 'AR Aging', 'finance', 'Outstanding customer invoices', '{"report":"ar_aging"}'),
  ('RPT-AP-AGING', 'AP Aging', 'finance', 'Open purchase accruals', '{"report":"ap_aging"}'),
  ('RPT-STOCK-VAL', 'Stock Valuation', 'inventory', 'Inventory value by warehouse', '{"report":"stock_valuation"}'),
  ('RPT-PAYROLL-SUM', 'Payroll Summary', 'hr', 'Latest payroll totals', '{"report":"payroll_summary"}'),
  ('RPT-PROC-SPEND', 'Procurement Spend', 'procurement', 'Spend by vendor', '{"report":"procurement_spend"}')
) AS v(code, name, mod, descr, cfg)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_saved_reports r WHERE r.company_id = c.id AND r.code = v.code);

INSERT INTO erp_dashboards (company_id, code, name, audience, layout)
SELECT c.id, v.code, v.name, v.aud, v.layout::jsonb
FROM erp_companies c
CROSS JOIN (VALUES
  ('DASH-CFO', 'CFO Dashboard', 'cfo', '[{"widget":"revenue_mtd","x":0,"y":0,"w":6,"h":4},{"widget":"ar_outstanding","x":6,"y":0,"w":6,"h":4},{"widget":"cash_position","x":0,"y":4,"w":4,"h":4},{"widget":"gross_margin","x":4,"y":4,"w":4,"h":4},{"widget":"ap_outstanding","x":8,"y":4,"w":4,"h":4}]'),
  ('DASH-OPS', 'Operations Dashboard', 'operations', '[{"widget":"stock_value","x":0,"y":0,"w":6,"h":4},{"widget":"reorder_alerts","x":6,"y":0,"w":6,"h":4},{"widget":"open_pos","x":0,"y":4,"w":6,"h":4},{"widget":"pending_deliveries","x":6,"y":4,"w":6,"h":4}]'),
  ('DASH-HR', 'HR Dashboard', 'hr', '[{"widget":"headcount","x":0,"y":0,"w":4,"h":4},{"widget":"payroll_mtd","x":4,"y":0,"w":4,"h":4},{"widget":"leave_pending","x":8,"y":0,"w":4,"h":4},{"widget":"attendance_rate","x":0,"y":4,"w":12,"h":4}]')
) AS v(code, name, aud, layout)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_dashboards d WHERE d.company_id = c.id AND d.code = v.code);

INSERT INTO erp_kpi_definitions (company_id, code, name, module, unit, target_value, warning_threshold, critical_threshold, higher_is_better, calc_config)
SELECT c.id, v.code, v.name, v.mod, v.unit, v.target, v.warn, v.crit, v.hib, v.cfg::jsonb
FROM erp_companies c
CROSS JOIN (VALUES
  ('KPI-REV-MTD', 'Revenue MTD', 'sales', 'KES', 5000000, 4000000, 3000000, TRUE, '{"metric":"revenue_mtd"}'),
  ('KPI-DSO', 'Days Sales Outstanding', 'finance', 'days', 45, 60, 90, FALSE, '{"metric":"dso"}'),
  ('KPI-STOCK-TURN', 'Inventory Turnover', 'inventory', 'ratio', 8, 6, 4, TRUE, '{"metric":"inventory_turnover"}'),
  ('KPI-OTIF', 'On-Time Delivery %', 'sales', 'percent', 95, 90, 85, TRUE, '{"metric":"otif"}'),
  ('KPI-PAYROLL-COST', 'Payroll Cost MTD', 'hr', 'KES', 2500000, 2800000, 3200000, FALSE, '{"metric":"payroll_mtd"}')
) AS v(code, name, mod, unit, target, warn, crit, hib, cfg)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_kpi_definitions k WHERE k.company_id = c.id AND k.code = v.code);
