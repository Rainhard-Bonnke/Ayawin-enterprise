ALTER TABLE erp_stock_adjustment_lines
  ADD COLUMN IF NOT EXISTS batch_no TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

ALTER TABLE erp_material_return_lines
  ADD COLUMN IF NOT EXISTS batch_no TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE TABLE IF NOT EXISTS erp_inventory_lot_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  notes TEXT NOT NULL,
  stock_quantity NUMERIC(18,4) NOT NULL CHECK (stock_quantity > 0),
  lot_count INTEGER NOT NULL CHECK (lot_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE(company_id, warehouse_id, item_id)
);

ALTER TABLE erp_inventory_lots
  ADD COLUMN IF NOT EXISTS opening_reconciliation_id UUID REFERENCES erp_inventory_lot_openings(id);
