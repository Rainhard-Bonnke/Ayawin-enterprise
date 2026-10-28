ALTER TABLE erp_supplier_return_credit_notes
  ADD COLUMN IF NOT EXISTS source_bill_line_id UUID REFERENCES erp_supplier_bill_lines(id),
  ADD COLUMN IF NOT EXISTS original_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS returned_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  ADD COLUMN IF NOT EXISTS inventory_claim_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (inventory_claim_amount >= 0),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  ADD COLUMN IF NOT EXISTS allocated_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  ADD COLUMN IF NOT EXISTS unapplied_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
  ADD COLUMN IF NOT EXISTS refund_bank_account_id UUID REFERENCES erp_chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS unapplied_account_id UUID REFERENCES erp_chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS refund_reference_no TEXT,
  ADD COLUMN IF NOT EXISTS received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS court_dispute_determined_on DATE,
  ADD COLUMN IF NOT EXISTS court_case_reference TEXT;

UPDATE erp_supplier_return_credit_notes c
SET inventory_claim_amount = c.amount,
    allocated_amount = COALESCE((SELECT SUM(a.amount) FROM erp_supplier_return_credit_allocations a WHERE a.credit_note_id = c.id AND a.company_id = c.company_id), 0),
    unapplied_amount = GREATEST(c.amount - COALESCE((SELECT SUM(a.amount) FROM erp_supplier_return_credit_allocations a WHERE a.credit_note_id = c.id AND a.company_id = c.company_id), 0), 0)
WHERE c.inventory_claim_amount = 0 AND c.amount > 0;

ALTER TABLE erp_supplier_return_credit_notes
  ADD CONSTRAINT erp_supplier_return_credit_amount_components_check
    CHECK (ABS(amount - inventory_claim_amount - vat_amount) <= 0.005),
  ADD CONSTRAINT erp_supplier_return_credit_settlement_check
    CHECK (ABS(amount - allocated_amount - refund_amount - unapplied_amount) <= 0.005),
  ADD CONSTRAINT erp_supplier_return_credit_refund_account_check
    CHECK ((refund_amount = 0 AND refund_bank_account_id IS NULL AND refund_reference_no IS NULL)
      OR (refund_amount > 0 AND refund_bank_account_id IS NOT NULL AND refund_reference_no IS NOT NULL)),
  ADD CONSTRAINT erp_supplier_return_credit_unapplied_account_check
    CHECK ((unapplied_amount = 0 AND unapplied_account_id IS NULL)
      OR (unapplied_amount > 0 AND unapplied_account_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS erp_supplier_return_credit_source_idx
  ON erp_supplier_return_credit_notes(company_id, source_bill_line_id, status)
  WHERE is_deleted = FALSE AND source_bill_line_id IS NOT NULL;
