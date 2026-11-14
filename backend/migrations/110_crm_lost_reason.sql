ALTER TABLE erp_opportunities
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS erp_sales_orders_quotation_unique_idx
  ON erp_sales_orders (company_id, quotation_id)
  WHERE quotation_id IS NOT NULL AND is_deleted = FALSE;