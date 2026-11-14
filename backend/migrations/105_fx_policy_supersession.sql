ALTER TABLE erp_fx_accounting_policies
  DROP CONSTRAINT IF EXISTS erp_fx_accounting_policies_status_check,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES erp_fx_accounting_policies (id),
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_user_id UUID;

ALTER TABLE erp_fx_accounting_policies
  ADD CONSTRAINT erp_fx_accounting_policies_status_check
    CHECK (status IN ('draft', 'approved', 'rejected', 'superseded')),
  ADD CONSTRAINT erp_fx_accounting_policies_supersession_metadata_check
    CHECK (status <> 'superseded' OR (superseded_by IS NOT NULL AND superseded_at IS NOT NULL AND superseded_by_user_id IS NOT NULL));

DROP INDEX IF EXISTS erp_fx_accounting_policies_active_currency_uidx;

CREATE UNIQUE INDEX erp_fx_accounting_policies_draft_currency_uidx
  ON erp_fx_accounting_policies (company_id, currency_code)
  WHERE status = 'draft' AND is_deleted = FALSE;

CREATE UNIQUE INDEX erp_fx_accounting_policies_approved_currency_uidx
  ON erp_fx_accounting_policies (company_id, currency_code)
  WHERE status = 'approved' AND is_deleted = FALSE;