-- Module 3: Financial Management — General Ledger core

CREATE TABLE IF NOT EXISTS erp_fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  year_label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, year_label)
);

CREATE TABLE IF NOT EXISTS erp_fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  fiscal_year_id UUID NOT NULL REFERENCES erp_fiscal_years (id),
  period_no SMALLINT NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'locked')),
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (fiscal_year_id, period_no)
);

CREATE INDEX IF NOT EXISTS erp_fiscal_periods_company_status_idx
  ON erp_fiscal_periods (company_id, status);

-- Journal headers
CREATE TABLE IF NOT EXISTS erp_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  fiscal_period_id UUID REFERENCES erp_fiscal_periods (id),
  branch_id UUID REFERENCES erp_branches (id),
  journal_no TEXT NOT NULL,
  journal_type TEXT NOT NULL DEFAULT 'general'
    CHECK (journal_type IN ('general', 'sales', 'purchase', 'payment', 'receipt', 'payroll', 'depreciation', 'adjustment', 'opening')),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_no TEXT,
  description TEXT,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES' REFERENCES erp_currencies (code),
  exchange_rate NUMERIC(18, 8) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'reversed', 'cancelled')),
  posted_at TIMESTAMPTZ,
  posted_by UUID,
  source_type TEXT,
  source_id UUID,
  total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, journal_no)
);

CREATE INDEX IF NOT EXISTS erp_journals_company_date_idx ON erp_journals (company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS erp_journals_company_status_idx ON erp_journals (company_id, status);

-- Journal lines
CREATE TABLE IF NOT EXISTS erp_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  journal_id UUID NOT NULL REFERENCES erp_journals (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  description TEXT,
  debit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  amount_foreign NUMERIC(18, 4) NOT NULL DEFAULT 0,
  cost_centre TEXT,
  department TEXT,
  project_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit = 0 OR credit = 0),
  UNIQUE (journal_id, line_no)
);

CREATE INDEX IF NOT EXISTS erp_journal_lines_journal_idx ON erp_journal_lines (journal_id);
CREATE INDEX IF NOT EXISTS erp_journal_lines_account_idx ON erp_journal_lines (company_id, account_id);

-- Account balances snapshot (per period)
CREATE TABLE IF NOT EXISTS erp_gl_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  fiscal_period_id UUID NOT NULL REFERENCES erp_fiscal_periods (id),
  account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  opening_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  opening_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  period_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  period_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  closing_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  closing_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (fiscal_period_id, account_id)
);

-- Dimension tags for reporting
CREATE TABLE IF NOT EXISTS erp_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  dimension_type TEXT NOT NULL CHECK (dimension_type IN ('cost_centre', 'department', 'project', 'product_line')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, dimension_type, code)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_fiscal_years', 'erp_fiscal_periods', 'erp_journals', 'erp_gl_balances', 'erp_dimensions'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
