-- Statutory obligations and independently posted remittance evidence per payroll run.
CREATE TABLE IF NOT EXISTS erp_payroll_statutory_remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  payroll_run_id UUID NOT NULL REFERENCES erp_payroll_runs (id),
  agency_code TEXT NOT NULL CHECK (agency_code IN ('KRA_PAYE', 'NSSF', 'SHA_SHIF', 'AHL')),
  liability_account_code TEXT NOT NULL CHECK (liability_account_code IN ('2110', '2120', '2130', '2140')),
  amount_due NUMERIC(18, 2) NOT NULL CHECK (amount_due > 0),
  amount_paid NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'partial', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id),
  UNIQUE (company_id, payroll_run_id, agency_code),
  CHECK (amount_paid <= amount_due)
);

CREATE INDEX IF NOT EXISTS erp_payroll_statutory_remittances_company_status_idx
  ON erp_payroll_statutory_remittances (company_id, status, due_date);

CREATE TABLE IF NOT EXISTS erp_payroll_remittance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  remittance_id UUID NOT NULL REFERENCES erp_payroll_statutory_remittances (id),
  payment_no TEXT NOT NULL,
  payment_date DATE NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  bank_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  reference_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES erp_users (id),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES erp_users (id),
  UNIQUE (company_id, payment_no),
  CHECK ((status = 'draft' AND approved_at IS NULL AND approved_by IS NULL)
      OR (status IN ('posted', 'cancelled') AND approved_at IS NOT NULL AND approved_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS erp_payroll_remittance_payments_company_date_idx
  ON erp_payroll_remittance_payments (company_id, payment_date DESC, status);
