CREATE TABLE IF NOT EXISTS erp_etims_event_sequences (
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('purchase','stock_movement')),
  next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id,event_kind)
);

CREATE TABLE IF NOT EXISTS erp_etims_event_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('purchase','stock_movement')),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','retry','synced','rejected','failed')),
  payload JSONB NOT NULL,
  response_payload JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (company_id,event_kind,source_type,source_id),
  UNIQUE (company_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS erp_etims_event_submissions_queue_idx
  ON erp_etims_event_submissions (status,next_attempt_at,created_at)
  WHERE status IN ('pending','retry');

CREATE INDEX IF NOT EXISTS erp_etims_event_submissions_company_idx
  ON erp_etims_event_submissions (company_id,status,created_at DESC);