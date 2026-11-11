ALTER TABLE erp_customer_credit_notes
  ADD COLUMN IF NOT EXISTS etims_status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (etims_status IN ('not_submitted','pending','processing','accepted','rejected','failed')),
  ADD COLUMN IF NOT EXISTS etims_kra_invoice_no BIGINT,
  ADD COLUMN IF NOT EXISTS etims_provider_reference TEXT;

CREATE TABLE IF NOT EXISTS erp_etims_credit_note_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  credit_note_id UUID NOT NULL REFERENCES erp_customer_credit_notes (id),
  original_invoice_id UUID NOT NULL REFERENCES erp_customer_invoices (id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','accepted','rejected','retry','failed')),
  payload JSONB NOT NULL,
  response_payload JSONB,
  provider_reference TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES erp_users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, credit_note_id),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS erp_etims_credit_note_queue_idx
  ON erp_etims_credit_note_submissions (status,next_attempt_at,queued_at)
  WHERE status IN ('pending','retry');