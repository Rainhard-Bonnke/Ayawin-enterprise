-- Durable invoice-linked M-Pesa requests and deduplicated provider receipts.
ALTER TABLE erp_customer_receipts
  ADD COLUMN IF NOT EXISTS provider_receipt_no TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS erp_customer_receipts_mpesa_provider_receipt_uidx
  ON erp_customer_receipts (company_id, provider_receipt_no)
  WHERE payment_method = 'mpesa' AND provider_receipt_no IS NOT NULL AND is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_mpesa_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  invoice_id UUID NOT NULL REFERENCES erp_customer_invoices (id),
  idempotency_key TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  account_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'awaiting_callback', 'callback_received', 'confirmed', 'failed', 'cancelled')),
  processing_stage TEXT CHECK (processing_stage IN ('initiate', 'verify')),
  merchant_request_id TEXT,
  checkout_request_id TEXT,
  provider_receipt_no TEXT,
  provider_payload JSONB,
  callback_payload JSONB,
  verification_payload JSONB,
  receipt_id UUID REFERENCES erp_customer_receipts (id),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id),
  UNIQUE (company_id, idempotency_key),
  UNIQUE (company_id, checkout_request_id),
  UNIQUE (company_id, provider_receipt_no)
);

CREATE INDEX IF NOT EXISTS erp_mpesa_requests_outbox_idx
  ON erp_mpesa_payment_requests (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'callback_received');

CREATE INDEX IF NOT EXISTS erp_mpesa_requests_invoice_idx
  ON erp_mpesa_payment_requests (company_id, invoice_id, created_at DESC);
