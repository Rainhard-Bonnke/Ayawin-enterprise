ALTER TABLE erp_supplier_bills
  ADD COLUMN IF NOT EXISTS etims_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS etims_receipt_signature TEXT,
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (evidence_status IN ('unverified', 'verified', 'rejected', 'not_required')),
  ADD COLUMN IF NOT EXISTS evidence_checked_at TIMESTAMPTZ;

ALTER TABLE erp_supplier_bill_lines
  ADD COLUMN IF NOT EXISTS tax_treatment TEXT NOT NULL DEFAULT 'standard'
    CHECK (tax_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  ADD COLUMN IF NOT EXISTS claimable_vat_ratio NUMERIC(5, 4) NOT NULL DEFAULT 1
    CHECK (claimable_vat_ratio >= 0 AND claimable_vat_ratio <= 1),
  ADD COLUMN IF NOT EXISTS claimable_vat NUMERIC(18, 4) NOT NULL DEFAULT 0
    CHECK (claimable_vat >= 0),
  ADD COLUMN IF NOT EXISTS non_claimable_vat NUMERIC(18, 4) NOT NULL DEFAULT 0
    CHECK (non_claimable_vat >= 0),
  ADD COLUMN IF NOT EXISTS input_vat_status TEXT NOT NULL DEFAULT 'held_no_evidence'
    CHECK (input_vat_status IN ('claimable', 'held_no_evidence', 'non_claimable'));

UPDATE erp_supplier_bill_lines
SET claimable_vat = tax_amount,
    non_claimable_vat = 0,
    claimable_vat_ratio = CASE WHEN tax_amount > 0 THEN 1 ELSE 0 END,
  tax_treatment = 'standard',
    input_vat_status = CASE WHEN tax_amount > 0 THEN 'held_no_evidence' ELSE 'non_claimable' END;

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, '1401', 'Input VAT Pending Evidence', 'asset', 2, TRUE, 'KES'
FROM erp_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM erp_chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_code = '1401'
);

UPDATE erp_chart_of_accounts child
SET parent_id = parent.id
FROM erp_chart_of_accounts parent
WHERE child.company_id = parent.company_id
  AND parent.account_code = '1000'
  AND child.account_code = '1401'
  AND child.parent_id IS NULL;

INSERT INTO erp_system_settings (company_id, category, setting_key, setting_value, description)
SELECT c.id, 'finance', 'non_claimable_vat_treatment', '"add_to_cost"'::jsonb,
       'Confirmed treatment for non-claimable input VAT.'
FROM erp_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM erp_system_settings s
  WHERE s.company_id = c.id AND s.category = 'finance' AND s.setting_key = 'non_claimable_vat_treatment'
);