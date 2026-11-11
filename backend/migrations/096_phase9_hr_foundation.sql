ALTER TABLE erp_employees
  ADD COLUMN IF NOT EXISTS national_id_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS kra_pin_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS nssf_number_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS sha_number_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS pii_key_version SMALLINT,
  ADD COLUMN IF NOT EXISTS termination_date DATE;

ALTER TABLE erp_leave_types
  ADD COLUMN IF NOT EXISTS carryover_limit_days NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS encashment_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS policy JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE erp_leave_balances
  ADD COLUMN IF NOT EXISTS carryover_days NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accrued_through DATE;

ALTER TABLE erp_leave_applications
  ADD COLUMN IF NOT EXISTS delegated_to UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS unpaid_days NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE erp_attendance
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS original_values JSONB,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS erp_employee_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  employee_id UUID NOT NULL UNIQUE REFERENCES erp_employees(id) ON DELETE CASCADE,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  document_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES erp_users(id),
  updated_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_employee_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  employee_id UUID NOT NULL REFERENCES erp_employees(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('probation_confirmation','promotion','salary_change','branch_transfer','termination')),
  effective_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied')),
  requested_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_values JSONB,
  decision_note TEXT,
  requested_by UUID NOT NULL REFERENCES erp_users(id),
  reviewed_by UUID REFERENCES erp_users(id),
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_employee_lifecycle_employee_date_idx
  ON erp_employee_lifecycle_events(company_id,employee_id,effective_date DESC);

CREATE TABLE IF NOT EXISTS erp_employee_pii_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  employee_id UUID NOT NULL REFERENCES erp_employees(id),
  accessed_by UUID NOT NULL REFERENCES erp_users(id),
  fields TEXT[] NOT NULL,
  purpose TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_employee_pii_access_employee_time_idx
  ON erp_employee_pii_access_log(company_id,employee_id,created_at DESC);

CREATE TABLE IF NOT EXISTS erp_payroll_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  employee_id UUID NOT NULL REFERENCES erp_employees(id),
  payroll_month DATE NOT NULL,
  input_type TEXT NOT NULL CHECK (input_type IN ('overtime','allowance','commission','helb','sacco','loan','pension','insurance','medical','mortgage','other')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','consumed')),
  source_reference TEXT,
  created_by UUID NOT NULL REFERENCES erp_users(id),
  approved_by UUID REFERENCES erp_users(id),
  approved_at TIMESTAMPTZ,
  consumed_by_run_id UUID REFERENCES erp_payroll_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_payroll_inputs_month_status_idx
  ON erp_payroll_inputs(company_id,payroll_month,status,employee_id);

CREATE TABLE IF NOT EXISTS erp_payroll_statutory_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  rule_code TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  parameters JSONB NOT NULL,
  source_url TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  created_by UUID REFERENCES erp_users(id),
  approved_by UUID REFERENCES erp_users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE(company_id,rule_code,effective_from)
);

CREATE INDEX IF NOT EXISTS erp_payroll_rule_sets_effective_idx
  ON erp_payroll_statutory_rule_sets(company_id,rule_code,effective_from DESC)
  WHERE status='approved';

CREATE TABLE IF NOT EXISTS erp_employment_termination_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  policy_code TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  policy JSONB NOT NULL,
  source_url TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  created_by UUID REFERENCES erp_users(id),
  approved_by UUID REFERENCES erp_users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE(company_id,policy_code,effective_from)
);

CREATE INDEX IF NOT EXISTS erp_employment_termination_policy_effective_idx
  ON erp_employment_termination_policies(company_id,policy_code,effective_from DESC)
  WHERE status='approved';

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'erp_employee_onboarding','erp_employee_lifecycle_events','erp_payroll_inputs',
    'erp_payroll_statutory_rule_sets','erp_employment_termination_policies'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',table_name,table_name);
  END LOOP;
END $$;