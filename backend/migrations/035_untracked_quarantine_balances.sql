CREATE TABLE IF NOT EXISTS erp_inventory_quarantine_balances (
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  PRIMARY KEY (company_id, warehouse_id, item_id)
);

CREATE TABLE IF NOT EXISTS erp_inventory_quarantine_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('quarantined', 'released')),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_inventory_quarantine_events_source_idx
  ON erp_inventory_quarantine_events(company_id, source_type, source_id, created_at DESC);
