CREATE TABLE IF NOT EXISTS erp_budget_forecast_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  department TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual NUMERIC(18,2) NOT NULL DEFAULT 0,
  forecast NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, department, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS erp_budget_forecast_company_period_idx
  ON erp_budget_forecast_lines (company_id, period_start, period_end, department);

INSERT INTO erp_budget_forecast_lines (
  company_id,
  department,
  period_start,
  period_end,
  budget,
  actual,
  forecast,
  status
)
SELECT c.id,
       v.department,
       DATE '2026-01-01',
       DATE '2026-12-31',
       v.budget,
       v.actual,
       v.forecast,
       'draft'
FROM erp_companies c
CROSS JOIN (
  VALUES
    ('Operations', 4200000, 3950000, 4300000),
    ('Sales', 5200000, 4900000, 5350000),
    ('Procurement', 3600000, 3740000, 3680000),
    ('Support', 1600000, 1550000, 1600000)
) AS v(department, budget, actual, forecast)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_budget_forecast_lines b
    WHERE b.company_id = c.id
      AND b.department = v.department
      AND b.period_start = DATE '2026-01-01'
      AND b.period_end = DATE '2026-12-31'
  );
