-- Module 6: HR & Payroll

CREATE TABLE IF NOT EXISTS erp_leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  days_per_year NUMERIC(8, 2) NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  accrual_method TEXT NOT NULL DEFAULT 'annual'
    CHECK (accrual_method IN ('annual', 'monthly', 'none')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  leave_type_id UUID NOT NULL REFERENCES erp_leave_types (id),
  balance_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (employee_id, leave_type_id)
);

CREATE TABLE IF NOT EXISTS erp_leave_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  leave_type_id UUID NOT NULL REFERENCES erp_leave_types (id),
  application_no TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested NUMERIC(8, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, application_no)
);

CREATE TABLE IF NOT EXISTS erp_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  branch_id UUID REFERENCES erp_branches (id),
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'KE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, holiday_date, branch_id)
);

CREATE TABLE IF NOT EXISTS erp_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  attendance_date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  hours_worked NUMERIC(8, 2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'leave', 'holiday')),
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS erp_employee_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  contract_type TEXT NOT NULL CHECK (contract_type IN ('permanent', 'contract', 'probation', 'intern')),
  start_date DATE NOT NULL,
  end_date DATE,
  basic_salary NUMERIC(18, 2) NOT NULL DEFAULT 0,
  house_allowance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS erp_payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  run_no TEXT NOT NULL,
  payroll_month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'calculated', 'approved', 'posted', 'cancelled')),
  total_gross NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_net NUMERIC(18, 2) NOT NULL DEFAULT 0,
  journal_id UUID REFERENCES erp_journals (id),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, run_no)
);

CREATE TABLE IF NOT EXISTS erp_payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  payroll_run_id UUID NOT NULL REFERENCES erp_payroll_runs (id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  gross_pay NUMERIC(18, 2) NOT NULL DEFAULT 0,
  paye NUMERIC(18, 2) NOT NULL DEFAULT 0,
  nhif NUMERIC(18, 2) NOT NULL DEFAULT 0,
  nssf NUMERIC(18, 2) NOT NULL DEFAULT 0,
  housing_levy NUMERIC(18, 2) NOT NULL DEFAULT 0,
  helb NUMERIC(18, 2) NOT NULL DEFAULT 0,
  sacco NUMERIC(18, 2) NOT NULL DEFAULT 0,
  loan_deduction NUMERIC(18, 2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(18, 2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(18, 2) NOT NULL DEFAULT 0,
  earnings_detail JSONB NOT NULL DEFAULT '[]',
  deductions_detail JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS erp_payroll_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id) UNIQUE,
  country_code CHAR(2) NOT NULL DEFAULT 'KE',
  nssf_employee_rate NUMERIC(8, 4) NOT NULL DEFAULT 6.0000,
  nssf_employer_rate NUMERIC(8, 4) NOT NULL DEFAULT 6.0000,
  nssf_ceiling NUMERIC(18, 2) NOT NULL DEFAULT 4320.00,
  nhif_brackets JSONB NOT NULL DEFAULT '[]',
  housing_levy_rate NUMERIC(8, 4) NOT NULL DEFAULT 1.5000,
  paye_bands JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_leave_types', 'erp_leave_balances', 'erp_leave_applications', 'erp_holidays',
    'erp_attendance', 'erp_employee_contracts', 'erp_payroll_runs', 'erp_payslips', 'erp_payroll_config'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
