-- Durable outbound notification queue with idempotent enqueue and retry history.
CREATE TABLE IF NOT EXISTS erp_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  destination TEXT NOT NULL CHECK (LENGTH(TRIM(destination)) > 0),
  subject TEXT NOT NULL DEFAULT '',
  message_body TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'retry', 'failed')),
  provider_message_id TEXT,
  provider_response JSONB,
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES erp_users (id),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS erp_notification_outbox_queue_idx
  ON erp_notification_outbox (channel, status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS erp_notification_outbox_company_date_idx
  ON erp_notification_outbox (company_id, created_at DESC);
