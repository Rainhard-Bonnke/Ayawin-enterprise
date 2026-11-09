-- Route close submission and independent review for delivery and collection reconciliation.
CREATE TABLE IF NOT EXISTS erp_route_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  route_code TEXT NOT NULL,
  route_date DATE NOT NULL,
  driver_user_id UUID NOT NULL REFERENCES erp_users (id),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected')),
  delivery_count INT NOT NULL CHECK (delivery_count > 0),
  proof_pending_count INT NOT NULL DEFAULT 0 CHECK (proof_pending_count >= 0),
  discrepancy_count INT NOT NULL DEFAULT 0 CHECK (discrepancy_count >= 0),
  invoice_value NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (invoice_value >= 0),
  matched_collection NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (matched_collection >= 0),
  declared_collection NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (declared_collection >= 0),
  collection_variance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  close_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by UUID NOT NULL REFERENCES erp_users (id),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES erp_users (id),
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES erp_users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, route_code, route_date, driver_user_id),
  CHECK (
    (status = 'submitted' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS erp_route_closures_company_status_date_idx
  ON erp_route_closures (company_id, status, route_date DESC);

CREATE INDEX IF NOT EXISTS erp_route_closures_driver_date_idx
  ON erp_route_closures (company_id, driver_user_id, route_date DESC);