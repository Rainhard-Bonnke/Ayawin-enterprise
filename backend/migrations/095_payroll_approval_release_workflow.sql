ALTER TABLE erp_payroll_runs
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

ALTER TABLE erp_payroll_runs DROP CONSTRAINT IF EXISTS erp_payroll_runs_status_check;
ALTER TABLE erp_payroll_runs ADD CONSTRAINT erp_payroll_runs_status_check
  CHECK (status IN ('draft', 'calculated', 'approved', 'locked', 'posting', 'posted', 'released', 'cancelled'));

CREATE INDEX IF NOT EXISTS erp_payroll_runs_company_status_month_idx
  ON erp_payroll_runs (company_id, status, payroll_month DESC)
  WHERE is_deleted = FALSE;