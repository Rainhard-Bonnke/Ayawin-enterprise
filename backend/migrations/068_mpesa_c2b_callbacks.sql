ALTER TABLE erp_mpesa_payment_requests
  DROP CONSTRAINT IF EXISTS erp_mpesa_payment_requests_status_check;

ALTER TABLE erp_mpesa_payment_requests
  ADD CONSTRAINT erp_mpesa_payment_requests_status_check
  CHECK (status IN ('pending', 'processing', 'awaiting_callback', 'callback_received', 'confirmed', 'failed', 'cancelled', 'timeout'));

CREATE TABLE IF NOT EXISTS erp_mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  trans_id TEXT NOT NULL UNIQUE,
  trans_time TIMESTAMPTZ NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  msisdn_masked TEXT,
  bill_reference TEXT,
  shortcode TEXT NOT NULL,
  customer_id UUID REFERENCES erp_customers (id),
  invoice_id UUID REFERENCES erp_customer_invoices (id),
  status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'matched', 'verified', 'posted', 'rejected')),
  verification_payload JSONB,
  callback_payload JSONB NOT NULL,
  receipt_id UUID REFERENCES erp_customer_receipts (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_mpesa_transactions_unallocated_idx
  ON erp_mpesa_transactions (company_id, trans_time DESC)
  WHERE status = 'unmatched';
