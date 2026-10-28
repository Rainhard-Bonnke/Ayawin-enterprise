-- Kenya payroll rules in force from February 2026 (NSSF Year 4).
-- Keep legacy NHIF data intact so historical payslips remain auditable.

ALTER TABLE erp_employees
  ADD COLUMN IF NOT EXISTS tax_resident BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE erp_payroll_config
  ADD COLUMN IF NOT EXISTS shif_rate NUMERIC(8, 4) NOT NULL DEFAULT 2.7500,
  ADD COLUMN IF NOT EXISTS shif_minimum NUMERIC(18, 2) NOT NULL DEFAULT 300.00,
  ADD COLUMN IF NOT EXISTS nssf_tier1_limit NUMERIC(18, 2) NOT NULL DEFAULT 9000.00,
  ADD COLUMN IF NOT EXISTS nssf_upper_limit NUMERIC(18, 2) NOT NULL DEFAULT 108000.00,
  ADD COLUMN IF NOT EXISTS personal_relief NUMERIC(18, 2) NOT NULL DEFAULT 2400.00,
  ADD COLUMN IF NOT EXISTS insurance_relief_rate NUMERIC(8, 4) NOT NULL DEFAULT 15.0000,
  ADD COLUMN IF NOT EXISTS insurance_relief_cap NUMERIC(18, 2) NOT NULL DEFAULT 5000.00;

ALTER TABLE erp_payroll_runs
  ADD COLUMN IF NOT EXISTS total_employer_cost NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE erp_payroll_runs DROP CONSTRAINT IF EXISTS erp_payroll_runs_status_check;
ALTER TABLE erp_payroll_runs ADD CONSTRAINT erp_payroll_runs_status_check
  CHECK (status IN ('draft', 'calculated', 'approved', 'posting', 'posted', 'cancelled'));

ALTER TABLE erp_payslips
  ADD COLUMN IF NOT EXISTS shif NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nssf_tier1 NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nssf_tier2 NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nssf_employer NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS housing_levy_employer NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_income NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_relief NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_relief NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_cost NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payroll_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Update seeded/current company configurations to the published Kenya defaults.
-- Company-specific PAYE bands are corrected to bracket widths, preserving the configured rates.
UPDATE erp_payroll_config
SET nssf_employee_rate = 6.0000,
    nssf_employer_rate = 6.0000,
    nssf_ceiling = 108000.00,
    nssf_tier1_limit = 9000.00,
    nssf_upper_limit = 108000.00,
    shif_rate = 2.7500,
    shif_minimum = 300.00,
    personal_relief = 2400.00,
    insurance_relief_rate = 15.0000,
    insurance_relief_cap = 5000.00,
    paye_bands = CASE
      WHEN paye_bands IN (
        '[]'::jsonb,
        '[{"min":0,"max":24000,"rate":10},{"min":24001,"max":32333,"rate":25},{"min":32334,"max":500000,"rate":30},{"min":500001,"max":800000,"rate":32.5},{"min":800001,"max":null,"rate":35}]'::jsonb
      ) THEN '[{"min":0,"max":24000,"rate":10},{"min":24001,"max":32333,"rate":25},{"min":32334,"max":500000,"rate":30},{"min":500001,"max":800000,"rate":32.5},{"min":800001,"max":null,"rate":35}]'::jsonb
      ELSE paye_bands
    END,
    updated_at = NOW();

-- Give statutory payroll balances dedicated liability accounts for reconciliation.
INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, v.code, v.name, 'liability', 2, TRUE, 'KES'
FROM erp_companies c
CROSS JOIN (VALUES
  ('2110', 'PAYE Payable'),
  ('2120', 'NSSF Payable'),
  ('2130', 'SHIF Payable'),
  ('2140', 'Affordable Housing Levy Payable'),
  ('2150', 'Other Payroll Deductions Payable'),
  ('2160', 'Net Wages Payable')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM erp_chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_code = v.code
);

UPDATE erp_chart_of_accounts child
SET parent_id = parent.id
FROM erp_chart_of_accounts parent
WHERE child.company_id = parent.company_id
  AND parent.account_code = '2000'
  AND child.account_code IN ('2110', '2120', '2130', '2140', '2150', '2160')
  AND child.parent_id IS NULL;

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code, parent_id)
SELECT c.id, '6100', 'Salaries and Employer Payroll Costs', 'expense', 2, TRUE, 'KES', p.id
FROM erp_companies c
JOIN erp_chart_of_accounts p ON p.company_id = c.id AND p.account_code = '6000'
WHERE NOT EXISTS (
  SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '6100'
);
