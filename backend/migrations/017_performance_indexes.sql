-- Index the bounded list queries used on the first render of ERP modules.
CREATE INDEX IF NOT EXISTS erp_sales_orders_company_date_idx
  ON erp_sales_orders (company_id, is_deleted, order_date DESC);

CREATE INDEX IF NOT EXISTS erp_customer_invoices_company_date_idx
  ON erp_customer_invoices (company_id, is_deleted, invoice_date DESC);

CREATE INDEX IF NOT EXISTS erp_stock_on_hand_company_item_idx
  ON erp_stock_on_hand (company_id, is_deleted, warehouse_id, item_id);
