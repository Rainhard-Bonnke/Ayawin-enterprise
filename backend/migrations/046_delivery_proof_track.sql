-- Delivery proof and route-traceability fields for route-to-cash reconciliation.
ALTER TABLE erp_delivery_notes
  ADD COLUMN IF NOT EXISTS route_code TEXT,
  ADD COLUMN IF NOT EXISTS driver_user_id UUID REFERENCES erp_users (id),
  ADD COLUMN IF NOT EXISTS vehicle_warehouse_id UUID REFERENCES erp_warehouses (id),
  ADD COLUMN IF NOT EXISTS proof_status TEXT NOT NULL DEFAULT 'pending_customer_confirmation'
    CHECK (proof_status IN ('pending_customer_confirmation', 'confirmed', 'discrepancy_reported')),
  ADD COLUMN IF NOT EXISTS customer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS customer_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discrepancy_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proof_note TEXT,
  ADD COLUMN IF NOT EXISTS signature_url TEXT;

ALTER TABLE erp_delivery_note_lines
  ADD COLUMN IF NOT EXISTS delivered_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_accepted_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS erp_delivery_notes_driver_route_idx
  ON erp_delivery_notes (company_id, driver_user_id, route_code, delivery_date DESC);

CREATE INDEX IF NOT EXISTS erp_delivery_notes_proof_status_idx
  ON erp_delivery_notes (company_id, proof_status, customer_confirmed, delivery_date DESC);
