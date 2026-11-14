ALTER TABLE erp_fixed_asset_depreciation_runs
  ADD COLUMN IF NOT EXISTS journal_id UUID REFERENCES erp_journals (id);

CREATE UNIQUE INDEX IF NOT EXISTS erp_fixed_asset_depreciation_runs_journal_uidx
  ON erp_fixed_asset_depreciation_runs (journal_id)
  WHERE journal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS erp_fixed_asset_depreciation_run_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  run_id UUID NOT NULL REFERENCES erp_fixed_asset_depreciation_runs (id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES erp_fixed_assets (id),
  asset_code TEXT NOT NULL,
  depreciation_amount NUMERIC(18, 2) NOT NULL CHECK (depreciation_amount > 0),
  accumulated_before NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (accumulated_before >= 0),
  months_in_period INTEGER NOT NULL CHECK (months_in_period > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS erp_asset_depr_run_lines_company_asset_idx
  ON erp_fixed_asset_depreciation_run_lines (company_id, asset_id, run_id);

INSERT INTO erp_chart_of_accounts (
  company_id, parent_id, account_code, account_name, account_type,
  level, is_postable, currency_code, is_active
)
SELECT company.id, parent.id, account.account_code, account.account_name,
       account.account_type, parent.level + 1, TRUE,
       company.base_currency_code, TRUE
FROM erp_companies company
JOIN (VALUES
  ('1000', '1590', 'Accumulated Depreciation', 'asset'),
  ('6000', '6200', 'Depreciation Expense', 'expense')
) AS account(parent_code, account_code, account_name, account_type) ON TRUE
JOIN erp_chart_of_accounts parent
  ON parent.company_id = company.id
 AND parent.account_code = account.parent_code
 AND parent.is_deleted = FALSE
WHERE company.is_deleted = FALSE
ON CONFLICT (company_id, account_code) DO NOTHING;