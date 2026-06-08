-- Dashboard aggregates and overdue sync on large invoice volumes

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_company_date_status
  ON erp_customer_invoices (company_id, invoice_date DESC, status)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoices_overdue_sync
  ON erp_customer_invoices (company_id, due_date)
  WHERE is_deleted = FALSE AND status IN ('posted', 'partial');

CREATE INDEX IF NOT EXISTS idx_erp_customer_invoice_lines_inv_item
  ON erp_customer_invoice_lines (invoice_id, item_id)
  WHERE is_deleted = FALSE;
