CREATE TABLE IF NOT EXISTS erp_mpesa_b2c_refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  credit_note_id UUID NOT NULL REFERENCES erp_customer_credit_notes (id),
  customer_id UUID NOT NULL REFERENCES erp_customers (id),
  idempotency_key TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0 AND amount = TRUNC(amount)),
  status TEXT NOT NULL CHECK (status IN ('prepared','processing','submitted','confirmed','failed')),
  originator_conversation_id TEXT,
  conversation_id TEXT,
  provider_transaction_id TEXT,
  provider_response JSONB,
  last_error TEXT,
  created_by UUID NOT NULL REFERENCES erp_users (id),
  approved_by UUID REFERENCES erp_users (id),
  approved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, idempotency_key),
  UNIQUE (company_id, credit_note_id)
);

CREATE INDEX IF NOT EXISTS erp_mpesa_b2c_daily_limit_idx
  ON erp_mpesa_b2c_refund_requests (company_id, created_at, status);

