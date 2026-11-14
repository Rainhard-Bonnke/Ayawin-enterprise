CREATE TABLE IF NOT EXISTS erp_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  expense_account_id UUID REFERENCES erp_chart_of_accounts (id),
  receipt_required BOOLEAN NOT NULL DEFAULT TRUE,
  per_claim_limit NUMERIC(18, 2) CHECK (per_claim_limit IS NULL OR per_claim_limit >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES erp_users (id),
  updated_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_expense_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  category_id UUID NOT NULL REFERENCES erp_expense_categories (id),
  fiscal_year INTEGER NOT NULL,
  allocated NUMERIC(18, 2) NOT NULL CHECK (allocated >= 0),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, category_id, fiscal_year)
);

CREATE TABLE IF NOT EXISTS erp_expense_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  employee_id UUID NOT NULL REFERENCES erp_employees (id),
  requested_by UUID NOT NULL REFERENCES erp_users (id),
  claim_date DATE NOT NULL,
  description TEXT NOT NULL,
  currency_code CHAR(3) NOT NULL REFERENCES erp_currencies (code),
  total_amount NUMERIC(18, 2) NOT NULL CHECK (total_amount > 0),
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

CREATE INDEX IF NOT EXISTS erp_expense_claims_company_status_date_idx
  ON erp_expense_claims (company_id, status, claim_date DESC)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_expense_claim_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  claim_id UUID NOT NULL REFERENCES erp_expense_claims (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES erp_expense_categories (id),
  description TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  cost_centre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_expense_claim_lines_company_claim_idx
  ON erp_expense_claim_lines (company_id, claim_id);

INSERT INTO erp_expense_categories (company_id, code, name, receipt_required)
SELECT company.id, category.code, category.name, TRUE
FROM erp_companies company
CROSS JOIN (VALUES
  ('GENERAL', 'General'),
  ('TRAVEL', 'Travel'),
  ('MEALS', 'Meals'),
  ('MILEAGE', 'Mileage'),
  ('PER_DIEM', 'Per diem')
) AS category(code, name)
WHERE company.is_deleted = FALSE
ON CONFLICT (company_id, code) DO NOTHING;