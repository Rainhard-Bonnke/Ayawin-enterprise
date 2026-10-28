CREATE TABLE IF NOT EXISTS erp_ar_collection_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  invoice_id UUID NOT NULL REFERENCES erp_customer_invoices(id),
  customer_id UUID NOT NULL REFERENCES erp_customers(id),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('call','email','visit','promise_to_pay','dispute','other')),
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  next_action_date DATE,
  promised_date DATE,
  promised_amount NUMERIC(18,4) CHECK (promised_amount IS NULL OR promised_amount > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES erp_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((activity_type = 'promise_to_pay' AND promised_date IS NOT NULL AND promised_amount IS NOT NULL)
      OR activity_type <> 'promise_to_pay')
);

CREATE INDEX IF NOT EXISTS erp_ar_collection_activities_due_idx
  ON erp_ar_collection_activities(company_id, status, next_action_date, created_at DESC);
CREATE INDEX IF NOT EXISTS erp_ar_collection_activities_invoice_idx
  ON erp_ar_collection_activities(company_id, invoice_id, created_at DESC);
