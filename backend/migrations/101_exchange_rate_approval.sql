ALTER TABLE erp_exchange_rates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE erp_exchange_rates
  DROP CONSTRAINT IF EXISTS erp_exchange_rates_company_id_from_currency_code_to_currency_code_effective_date_key;

ALTER TABLE erp_exchange_rates
  ADD CONSTRAINT erp_exchange_rates_status_check
    CHECK (status IN ('draft', 'approved', 'rejected')),
  ADD CONSTRAINT erp_exchange_rates_approval_metadata_check
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  ADD CONSTRAINT erp_exchange_rates_rejection_metadata_check
    CHECK (status <> 'rejected' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND decision_reason IS NOT NULL));

CREATE UNIQUE INDEX erp_exchange_rates_active_effective_date_uidx
  ON erp_exchange_rates (company_id, from_currency_code, to_currency_code, effective_date)
  WHERE status IN ('draft', 'approved') AND is_deleted = FALSE;