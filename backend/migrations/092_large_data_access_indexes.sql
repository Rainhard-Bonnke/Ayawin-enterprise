CREATE INDEX IF NOT EXISTS erp_gl_balances_company_period_account_idx
  ON erp_gl_balances (company_id, fiscal_period_id, account_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS erp_delivery_notes_posted_order_date_idx
  ON erp_delivery_notes (company_id, sales_order_id, delivery_date DESC)
  WHERE status = 'posted' AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS erp_stock_ledger_company_date_item_idx
  ON erp_stock_ledger (company_id, movement_date, item_id, warehouse_id);

CREATE INDEX IF NOT EXISTS erp_stock_ledger_company_item_date_idx
  ON erp_stock_ledger (company_id, item_id, movement_date);