ALTER TABLE erp_inventory_lots
  ADD COLUMN IF NOT EXISTS quarantined_quantity NUMERIC(18,4) NOT NULL DEFAULT 0
  CHECK (quarantined_quantity >= 0 AND quarantined_quantity <= quantity);

CREATE TABLE IF NOT EXISTS erp_inventory_lot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  lot_id UUID NOT NULL REFERENCES erp_inventory_lots(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('quarantined','released')),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_inventory_lot_events_history_idx
  ON erp_inventory_lot_events(company_id, lot_id, created_at DESC);
