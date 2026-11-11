ALTER TABLE erp_items
  DROP CONSTRAINT IF EXISTS erp_items_etims_sync_status_check;

ALTER TABLE erp_items
  ADD CONSTRAINT erp_items_etims_sync_status_check
  CHECK (etims_sync_status IN ('unmapped','pending','synced','failed'));

CREATE TABLE IF NOT EXISTS erp_etims_code_lists (
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code_class TEXT NOT NULL,
  code TEXT NOT NULL,
  code_name TEXT,
  code_description TEXT,
  sort_order INTEGER,
  user_defined_code_1 TEXT,
  user_defined_code_2 TEXT,
  user_defined_code_3 TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (company_id, code_class, code)
);

CREATE TABLE IF NOT EXISTS erp_etims_item_classifications (
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  item_class_code TEXT NOT NULL,
  item_class_name TEXT NOT NULL,
  item_class_level INTEGER,
  tax_type_code TEXT,
  major_target BOOLEAN,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (company_id, item_class_code)
);

CREATE TABLE IF NOT EXISTS erp_etims_item_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','synced','failed')),
  payload JSONB NOT NULL,
  response_payload JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, item_id),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS erp_etims_item_registrations_queue_idx
  ON erp_etims_item_registrations (status, next_attempt_at, created_at);