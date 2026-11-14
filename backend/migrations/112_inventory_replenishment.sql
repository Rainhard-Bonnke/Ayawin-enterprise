ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS minimum_stock NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maximum_stock NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS supplier_lead_time_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_vendor_id UUID REFERENCES erp_vendors (id);

UPDATE erp_items
SET minimum_stock = reorder_point
WHERE minimum_stock = 0 AND reorder_point > 0;

ALTER TABLE erp_items
  ADD CONSTRAINT erp_items_replenishment_range_chk
  CHECK (minimum_stock >= 0 AND (maximum_stock IS NULL OR maximum_stock >= minimum_stock)),
  ADD CONSTRAINT erp_items_supplier_lead_time_chk
  CHECK (supplier_lead_time_days >= 0);

ALTER TABLE erp_purchase_requisitions
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES erp_vendors (id);

CREATE INDEX IF NOT EXISTS erp_items_preferred_vendor_idx
  ON erp_items (company_id, preferred_vendor_id)
  WHERE preferred_vendor_id IS NOT NULL AND is_deleted = FALSE;