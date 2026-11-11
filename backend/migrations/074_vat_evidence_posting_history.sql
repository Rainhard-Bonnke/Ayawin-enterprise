ALTER TABLE erp_supplier_bills
  ADD COLUMN IF NOT EXISTS input_vat_posting_status TEXT
    CHECK (input_vat_posting_status IN ('claimable', 'held_no_evidence', 'legacy_input_vat_1400')),
  ADD COLUMN IF NOT EXISTS evidence_reclassification_journal_id UUID REFERENCES erp_journals (id);

UPDATE erp_supplier_bills
SET input_vat_posting_status = 'legacy_input_vat_1400'
WHERE status IN ('posted', 'partial', 'paid', 'overdue')
  AND input_vat_posting_status IS NULL;