CREATE TABLE IF NOT EXISTS erp_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  template_code TEXT NOT NULL CHECK (template_code IN ('invoice_issued','payment_received','overdue_reminder','payslip_available')),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  subject_template TEXT,
  message_template TEXT NOT NULL CHECK (length(message_template) BETWEEN 1 AND 10000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES erp_users (id),
  updated_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, template_code, channel),
  CHECK ((channel = 'email' AND subject_template IS NOT NULL AND length(subject_template) > 0)
      OR (channel = 'sms' AND subject_template IS NULL))
);

CREATE TABLE IF NOT EXISTS erp_notification_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  destination TEXT NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, channel, destination)
);

ALTER TABLE erp_notification_outbox
  ADD COLUMN IF NOT EXISTS template_code TEXT;

CREATE INDEX IF NOT EXISTS erp_notification_opt_out_lookup_idx
  ON erp_notification_opt_outs (company_id, channel, LOWER(destination));