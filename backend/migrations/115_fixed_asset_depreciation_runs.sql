CREATE TABLE IF NOT EXISTS erp_fixed_asset_depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'reversed')),
  total_depreciation NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS erp_asset_depr_run_company_period_idx
  ON erp_fixed_asset_depreciation_runs (company_id, period_start, period_end, status);
