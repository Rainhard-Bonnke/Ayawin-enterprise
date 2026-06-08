-- Additional indexes for load benchmarks and FK/date-range queries

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_company_invoice_date
  ON erp_customer_invoices (company_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_company_due_date
  ON erp_customer_invoices (company_id, due_date)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_customer
  ON erp_sales_orders (customer_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_warehouse
  ON erp_sales_orders (warehouse_id)
  WHERE warehouse_id IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_sales_order
  ON erp_customer_invoices (sales_order_id)
  WHERE sales_order_id IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_sales_order_lines_order
  ON erp_sales_order_lines (sales_order_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoice_lines_invoice
  ON erp_customer_invoice_lines (invoice_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_delivery_notes_sales_order
  ON erp_delivery_notes (sales_order_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_items_company_active_code
  ON erp_items (company_id, item_code)
  WHERE is_deleted = FALSE AND is_active = TRUE;

-- Trigram search for product lookup (requires extension; skip index if unavailable)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_erp_items_name_trgm
  ON erp_items USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_erp_items_code_trgm
  ON erp_items USING gin (item_code gin_trgm_ops);
