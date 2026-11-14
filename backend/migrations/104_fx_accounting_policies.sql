CREATE TABLE IF NOT EXISTS erp_fx_accounting_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  currency_code CHAR(3) NOT NULL REFERENCES erp_currencies (code),
  base_currency_code CHAR(3) NOT NULL REFERENCES erp_currencies (code),
  rate_direction TEXT NOT NULL CHECK (rate_direction IN ('base_per_transaction', 'transaction_per_base')),
  rate_source TEXT NOT NULL CHECK (length(btrim(rate_source)) > 0),
  effective_date_policy TEXT NOT NULL CHECK (effective_date_policy = 'exact_date'),
  rounding_method TEXT NOT NULL CHECK (rounding_method = 'currency_minor_half_up'),
  realized_gain_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  realized_loss_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  unrealized_gain_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  unrealized_loss_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  monetary_account_ids UUID[] NOT NULL CHECK (cardinality(monetary_account_ids) > 0),
  reversal_policy TEXT NOT NULL CHECK (reversal_policy = 'next_period_start'),
  foreign_posting_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK (foreign_posting_enabled = FALSE),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (currency_code <> base_currency_code),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'rejected' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND decision_reason IS NOT NULL)),
  UNIQUE (company_id, currency_code, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_fx_accounting_policies_active_currency_uidx
  ON erp_fx_accounting_policies (company_id, currency_code)
  WHERE status IN ('draft', 'approved') AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS erp_fx_accounting_policies_company_status_idx
  ON erp_fx_accounting_policies (company_id, status, currency_code);