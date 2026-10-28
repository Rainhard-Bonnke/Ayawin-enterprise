CREATE TABLE IF NOT EXISTS erp_material_issue_layer_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  issue_line_id UUID NOT NULL REFERENCES erp_material_issue_lines(id) ON DELETE CASCADE,
  layer_id UUID NOT NULL REFERENCES erp_inventory_lot_layers(id),
  batch_no TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_material_issue_layer_allocations_source_idx
  ON erp_material_issue_layer_allocations(company_id, issue_line_id, batch_no, expiry_date, created_at);

ALTER TABLE erp_material_return_lines
  ADD COLUMN IF NOT EXISTS source_layer_id UUID REFERENCES erp_inventory_lot_layers(id);

CREATE INDEX IF NOT EXISTS erp_material_return_lines_source_layer_idx
  ON erp_material_return_lines(company_id, source_layer_id)
  WHERE source_layer_id IS NOT NULL;
