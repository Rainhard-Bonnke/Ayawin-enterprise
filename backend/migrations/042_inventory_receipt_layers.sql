CREATE TABLE IF NOT EXISTS erp_inventory_lot_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  lot_id UUID NOT NULL REFERENCES erp_inventory_lots(id),
  parent_layer_id UUID REFERENCES erp_inventory_lot_layers(id),
  source_receipt_line_id UUID REFERENCES erp_goods_receipt_lines(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('supplier_receipt','transfer','material_return','stock_adjustment','opening','legacy')),
  source_reference_id UUID,
  received_quantity NUMERIC(18,4) NOT NULL CHECK (received_quantity > 0),
  quantity_remaining NUMERIC(18,4) NOT NULL CHECK (quantity_remaining >= 0),
  quarantined_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (quarantined_quantity >= 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  CHECK (quarantined_quantity <= quantity_remaining)
);

CREATE INDEX IF NOT EXISTS erp_inventory_lot_layers_fifo_idx
  ON erp_inventory_lot_layers(company_id, lot_id, created_at, id)
  WHERE quantity_remaining > 0;
CREATE INDEX IF NOT EXISTS erp_inventory_lot_layers_source_idx
  ON erp_inventory_lot_layers(company_id, source_receipt_line_id)
  WHERE source_receipt_line_id IS NOT NULL;

ALTER TABLE erp_goods_receipt_lot_links
  ADD COLUMN IF NOT EXISTS layer_id UUID REFERENCES erp_inventory_lot_layers(id);

ALTER TABLE erp_stock_transfer_lines
  ADD COLUMN IF NOT EXISTS source_layer_id UUID REFERENCES erp_inventory_lot_layers(id);

CREATE TABLE IF NOT EXISTS erp_inventory_disposition_layer_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  disposition_line_id UUID NOT NULL REFERENCES erp_inventory_disposition_lines(id) ON DELETE CASCADE,
  layer_id UUID NOT NULL REFERENCES erp_inventory_lot_layers(id),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  disposition_action TEXT NOT NULL CHECK (disposition_action IN ('released','written_off','supplier_returned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_inventory_disposition_layer_allocations_source_idx
  ON erp_inventory_disposition_layer_allocations(company_id, disposition_line_id, layer_id);

INSERT INTO erp_inventory_lot_layers (
  company_id, lot_id, source_type, received_quantity, quantity_remaining, quarantined_quantity, unit_cost
)
SELECT company_id, id, 'legacy', quantity, quantity, quarantined_quantity, unit_cost
FROM erp_inventory_lots
WHERE quantity > 0
  AND NOT EXISTS (SELECT 1 FROM erp_inventory_lot_layers layer WHERE layer.lot_id = erp_inventory_lots.id);
