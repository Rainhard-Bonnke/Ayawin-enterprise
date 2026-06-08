-- Performance indexes for high-volume list and date-range queries

CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_company_date
  ON erp_sales_orders (company_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_company_status
  ON erp_sales_orders (company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_company_status
  ON erp_customer_invoices (company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_company_customer
  ON erp_customer_invoices (company_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_erp_stock_ledger_company_item_date
  ON erp_stock_ledger (company_id, item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_erp_delivery_notes_company_status
  ON erp_delivery_notes (company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_leave_applications_company_employee
  ON erp_leave_applications (company_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_erp_password_reset_tokens_user_active
  ON erp_password_reset_tokens (user_id, expires_at)
  WHERE used_at IS NULL;
