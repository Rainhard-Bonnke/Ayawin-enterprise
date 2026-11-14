CREATE TABLE IF NOT EXISTS erp_fx_revaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  fiscal_period_id UUID NOT NULL REFERENCES erp_fiscal_periods (id),
  currency_code CHAR(3) NOT NULL REFERENCES erp_currencies (code),
  accounting_policy_id UUID NOT NULL REFERENCES erp_fx_accounting_policies (id),
  exchange_rate_id UUID NOT NULL REFERENCES erp_exchange_rates (id),
  closing_rate NUMERIC(18, 8) NOT NULL CHECK (closing_rate > 0),
  journal_id UUID REFERENCES erp_journals (id),
  reversal_journal_id UUID REFERENCES erp_journals (id),
  total_gain NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_gain >= 0),
  total_loss NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_loss >= 0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  created_by UUID NOT NULL REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_period_id, currency_code),
  UNIQUE (journal_id),
  UNIQUE (reversal_journal_id)
);

CREATE TABLE IF NOT EXISTS erp_fx_revaluation_run_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  run_id UUID NOT NULL REFERENCES erp_fx_revaluation_runs (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  foreign_balance NUMERIC(18, 4) NOT NULL,
  carrying_base_amount NUMERIC(18, 4) NOT NULL,
  closing_base_amount NUMERIC(18, 4) NOT NULL,
  variance_base_amount NUMERIC(18, 2) NOT NULL,
  gain_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  loss_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, account_id)
);

CREATE INDEX IF NOT EXISTS erp_fx_revaluation_lines_company_account_idx
  ON erp_fx_revaluation_run_lines (company_id, account_id, run_id);