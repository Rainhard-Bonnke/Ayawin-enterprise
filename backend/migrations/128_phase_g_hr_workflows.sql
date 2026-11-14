CREATE TABLE IF NOT EXISTS erp_employee_profile_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  requested_by UUID NOT NULL REFERENCES erp_users (id),
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_note TEXT,
  reviewed_by UUID REFERENCES erp_users (id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_employee_profile_changes_company_status
  ON erp_employee_profile_change_requests (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS erp_employee_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  requested_by UUID NOT NULL REFERENCES erp_users (id),
  claim_date DATE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  total_amount NUMERIC(18,2) NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
  decision_note TEXT,
  reviewed_by UUID REFERENCES erp_users (id),
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_employee_claims_company_status
  ON erp_employee_claims (company_id, status, claim_date DESC)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_payroll_leave_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  leave_type_id UUID NOT NULL REFERENCES erp_leave_types (id),
  payroll_deduction_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (payroll_deduction_percent BETWEEN 0 AND 100),
  paid_leave_requires_balance BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_balance_days NUMERIC(6,2) NOT NULL DEFAULT 0
    CHECK (minimum_balance_days >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, leave_type_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_erp_payroll_leave_rules_effective
  ON erp_payroll_leave_rules (company_id, leave_type_id, effective_from DESC)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS erp_hr_future_effective_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  effective_from DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'applied', 'cancelled')),
  created_by UUID REFERENCES erp_users (id),
  applied_by UUID REFERENCES erp_users (id),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_hr_future_events_due
  ON erp_hr_future_effective_events (effective_from, created_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS erp_hr_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  policy_name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days > 0),
  archival_required BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, policy_name)
);