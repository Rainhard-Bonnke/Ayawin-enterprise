ALTER TABLE erp_customer_credit_notes
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  ADD COLUMN IF NOT EXISTS refund_bank_account_id UUID REFERENCES erp_chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS refund_reference_no TEXT,
  ADD COLUMN IF NOT EXISTS refund_journal_id UUID REFERENCES erp_journals(id);

ALTER TABLE erp_customer_credit_notes
  DROP CONSTRAINT IF EXISTS erp_customer_credit_note_refund_split_check,
  ADD CONSTRAINT erp_customer_credit_note_refund_split_check
    CHECK (refund_amount <= total_amount AND (
      (refund_amount = 0 AND refund_bank_account_id IS NULL AND refund_reference_no IS NULL)
      OR (refund_amount > 0 AND refund_bank_account_id IS NOT NULL AND refund_reference_no IS NOT NULL)
    ));
