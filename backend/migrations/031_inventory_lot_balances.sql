ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS lot_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS erp_inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  batch_no TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  UNIQUE (company_id, warehouse_id, item_id, batch_no, expiry_date)
);

CREATE INDEX IF NOT EXISTS erp_inventory_lots_fefo_idx
  ON erp_inventory_lots (company_id, warehouse_id, item_id, expiry_date, batch_no)
  WHERE quantity > 0;

DROP TRIGGER IF EXISTS trg_erp_inventory_lots_updated_at ON erp_inventory_lots;
CREATE TRIGGER trg_erp_inventory_lots_updated_at BEFORE UPDATE ON erp_inventory_lots
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();
