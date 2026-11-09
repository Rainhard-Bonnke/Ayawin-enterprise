-- Durable, idempotent eTIMS submission queue. Provider acceptance remains explicit.
ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS etims_status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (etims_status IN ('not_submitted', 'pending', 'processing', 'accepted', 'rejected', 'failed')),
  ADD COLUMN IF NOT EXISTS etims_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS erp_etims_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  invoice_id UUID NOT NULL REFERENCES erp_customer_invoices (id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'accepted', 'rejected', 'retry', 'failed')),
  payload JSONB NOT NULL,
  response_payload JSONB,
  provider_reference TEXT,
  qr_code TEXT,
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES erp_users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, invoice_id),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS erp_etims_submissions_queue_idx
  ON erp_etims_submissions (status, next_attempt_at, queued_at)
  WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS erp_etims_submissions_company_status_idx
  ON erp_etims_submissions (company_id, status, queued_at DESC);
