ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS country_of_origin TEXT,
  ADD COLUMN IF NOT EXISTS product_type TEXT,
  ADD COLUMN IF NOT EXISTS packaging_tier TEXT,
  ADD COLUMN IF NOT EXISTS source_stock_status TEXT,
  ADD COLUMN IF NOT EXISTS catalog_source TEXT,
  ADD COLUMN IF NOT EXISTS is_catalog_certified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS erp_items_certified_catalog_idx
  ON erp_items (company_id, item_code)
  WHERE is_catalog_certified = TRUE AND is_deleted = FALSE;