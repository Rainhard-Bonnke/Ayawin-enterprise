ALTER TABLE erp_supplier_bill_lines
  ADD COLUMN IF NOT EXISTS non_claimable_vat_account_id UUID REFERENCES erp_chart_of_accounts (id);

UPDATE erp_supplier_bill_lines
SET non_claimable_vat_account_id = account_id
WHERE non_claimable_vat > 0 AND non_claimable_vat_account_id IS NULL;

ALTER TABLE erp_supplier_return_credit_notes
  ADD COLUMN IF NOT EXISTS claimable_vat_ratio NUMERIC(5, 4) NOT NULL DEFAULT 1
    CHECK (claimable_vat_ratio >= 0 AND claimable_vat_ratio <= 1),
  ADD COLUMN IF NOT EXISTS claimable_vat_amount NUMERIC(18, 4) NOT NULL DEFAULT 0
    CHECK (claimable_vat_amount >= 0),
  ADD COLUMN IF NOT EXISTS non_claimable_vat_amount NUMERIC(18, 4) NOT NULL DEFAULT 0
    CHECK (non_claimable_vat_amount >= 0),
  ADD COLUMN IF NOT EXISTS source_evidence_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (source_evidence_status IN ('unverified', 'verified', 'rejected', 'not_required'));

UPDATE erp_supplier_return_credit_notes c
SET claimable_vat_ratio = COALESCE(bl.claimable_vat_ratio, 1),
    claimable_vat_amount = ROUND(c.vat_amount * COALESCE(bl.claimable_vat_ratio, 1), 2),
    non_claimable_vat_amount = c.vat_amount - ROUND(c.vat_amount * COALESCE(bl.claimable_vat_ratio, 1), 2),
    source_evidence_status = COALESCE(b.evidence_status, 'unverified')
FROM erp_supplier_bill_lines bl
JOIN erp_supplier_bills b ON b.id = bl.bill_id AND b.company_id = bl.company_id
WHERE c.source_bill_line_id = bl.id AND c.company_id = bl.company_id;

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, '1402', 'Non-Claimable Input VAT Expense', 'expense', 2, TRUE, 'KES'
FROM erp_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM erp_chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_code = '1402'
);

UPDATE erp_chart_of_accounts child
SET parent_id = parent.id
FROM erp_chart_of_accounts parent
WHERE child.company_id = parent.company_id
  AND parent.account_code = '5000'
  AND child.account_code = '1402'
  AND child.parent_id IS NULL;