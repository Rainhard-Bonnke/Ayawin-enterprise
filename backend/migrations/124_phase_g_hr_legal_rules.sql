CREATE TABLE IF NOT EXISTS erp_hr_legal_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  rule_group TEXT NOT NULL CHECK (rule_group IN ('leave','attendance','termination','payroll','discipline','benefits')),
  rule_key TEXT NOT NULL,
  rule_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  description TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_date DATE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','superseded')),
  created_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, rule_group, rule_key, effective_from)
);

INSERT INTO erp_hr_legal_rules (
  company_id, rule_group, rule_key, rule_value, description, source_name, source_url, source_date, effective_from, status
)
SELECT c.id, v.rule_group, v.rule_key, v.rule_value, v.description, v.source_name, v.source_url, CAST(v.source_date AS DATE), CURRENT_DATE, 'active'
FROM erp_companies c
CROSS JOIN (VALUES
  ('leave', 'annual_leave_days', 21, 'Minimum annual leave under Kenyan employment law.', 'Employment Act, 2007', 'https://www.kenyalaw.org/kl/index.php?id=327', '2007-01-01'),
  ('attendance', 'overtime_normal_rate_multiplier', 1.5, 'Overtime premium for hours beyond the normal working day.', 'Employment Act, 2007', 'https://www.kenyalaw.org/kl/index.php?id=327', '2007-01-01'),
  ('attendance', 'overtime_rest_day_multiplier', 2, 'Rest day overtime premium.', 'Employment Act, 2007', 'https://www.kenyalaw.org/kl/index.php?id=327', '2007-01-01'),
  ('termination', 'notice_period_days', 30, 'Termination notice period for continuous employment.', 'Employment Act, 2007', 'https://www.kenyalaw.org/kl/index.php?id=327', '2007-01-01'),
  ('termination', 'minimum_final_dues_days', 14, 'Final dues may include accrued leave and other earned benefits.', 'Employment Act, 2007', 'https://www.kenyalaw.org/kl/index.php?id=327', '2007-01-01'),
  ('payroll', 'nssf_employee_rate', 0.06, 'Employee NSSF contribution rate.', 'National Social Security Fund Act', 'https://www.nssf.or.ke/', '2024-01-01'),
  ('payroll', 'housing_levy_rate', 0.015, 'Housing levy employer/employee rate.', 'Housing Levy Act', 'https://www.kenya.go.ke/', '2024-01-01')
) AS v(rule_group, rule_key, rule_value, description, source_name, source_url, source_date)
WHERE NOT EXISTS (
  SELECT 1 FROM erp_hr_legal_rules r
  WHERE r.company_id = c.id AND r.rule_group = v.rule_group AND r.rule_key = v.rule_key AND r.status = 'active'
)
ON CONFLICT (company_id, rule_group, rule_key, effective_from) DO NOTHING;

CREATE INDEX IF NOT EXISTS erp_hr_legal_rules_company_group_idx
  ON erp_hr_legal_rules(company_id, rule_group, rule_key, effective_from DESC);

DROP TRIGGER IF EXISTS trg_erp_hr_legal_rules_updated_at ON erp_hr_legal_rules;
CREATE TRIGGER trg_erp_hr_legal_rules_updated_at
  BEFORE UPDATE ON erp_hr_legal_rules
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();
