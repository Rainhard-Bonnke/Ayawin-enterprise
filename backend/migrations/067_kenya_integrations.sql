ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS etims_item_classification_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS etims_item_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS etims_item_type_code VARCHAR(5),
  ADD COLUMN IF NOT EXISTS etims_origin_country_code VARCHAR(5),
  ADD COLUMN IF NOT EXISTS etims_packaging_unit_code VARCHAR(5),
  ADD COLUMN IF NOT EXISTS etims_package_quantity NUMERIC(13, 2),
  ADD COLUMN IF NOT EXISTS etims_quantity_unit_code VARCHAR(5),
  ADD COLUMN IF NOT EXISTS etims_tax_type_code VARCHAR(5),
  ADD COLUMN IF NOT EXISTS etims_sync_status TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (etims_sync_status IN ('unmapped', 'pending', 'synced', 'failed')),
  ADD COLUMN IF NOT EXISTS etims_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etims_last_error TEXT;

ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS etims_cu_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS etims_receipt_signature TEXT,
  ADD COLUMN IF NOT EXISTS etims_internal_data TEXT,
  ADD COLUMN IF NOT EXISTS etims_cu_id TEXT,
  ADD COLUMN IF NOT EXISTS etims_receipt_counter TEXT,
  ADD COLUMN IF NOT EXISTS etims_cu_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etims_verification_data TEXT,
  ADD COLUMN IF NOT EXISTS etims_response_payload JSONB;

ALTER TABLE erp_etims_submissions
  ADD COLUMN IF NOT EXISTS correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0);

CREATE TABLE IF NOT EXISTS erp_integration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  branch_id UUID REFERENCES erp_branches (id),
  provider TEXT NOT NULL CHECK (provider IN ('etims', 'mpesa')),
  provider_mode TEXT NOT NULL DEFAULT 'disabled'
    CHECK (provider_mode IN ('disabled', 'mock', 'sandbox')),
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_payload_encrypted TEXT,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_integration_settings_branch_uidx
  ON erp_integration_settings (company_id, branch_id, provider)
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS erp_integration_settings_company_uidx
  ON erp_integration_settings (company_id, provider)
  WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS erp_integration_settings_company_provider_idx
  ON erp_integration_settings (company_id, provider, branch_id);

ALTER TABLE erp_integration_logs
  ADD COLUMN IF NOT EXISTS correlation_id UUID,
  ADD COLUMN IF NOT EXISTS duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS outcome TEXT;

CREATE INDEX IF NOT EXISTS erp_integration_logs_company_provider_date_idx
  ON erp_integration_logs (company_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS erp_items_etims_unmapped_idx
  ON erp_items (company_id, item_code)
  WHERE is_deleted = FALSE AND is_active = TRUE AND etims_sync_status = 'unmapped';
