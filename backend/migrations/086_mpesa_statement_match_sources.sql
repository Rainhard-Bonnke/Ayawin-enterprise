ALTER TABLE erp_mpesa_statement_lines
  ADD COLUMN IF NOT EXISTS matched_source TEXT
    CHECK (matched_source IS NULL OR matched_source IN ('c2b','stk','customer_receipt')),
  ADD COLUMN IF NOT EXISTS matched_source_id UUID;