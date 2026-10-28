CREATE TABLE IF NOT EXISTS erp_fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  asset_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  acquisition_date DATE NOT NULL,
  acquisition_cost NUMERIC(14, 2) NOT NULL CHECK (acquisition_cost >= 0),
  residual_value NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  useful_life_months INTEGER NOT NULL DEFAULT 60 CHECK (useful_life_months > 0),
  location TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES erp_users(id),
  updated_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, asset_code)
);

CREATE INDEX IF NOT EXISTS erp_fixed_assets_company_status_idx
  ON erp_fixed_assets (company_id, status, acquisition_date)
  WHERE is_deleted = FALSE;
