INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('sales', 'receipt_create', 'sales.receipt.create', 'Record customer receipts'),
  ('sales', 'receipt_approve', 'sales.receipt.approve', 'Approve customer receipts above the company threshold')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT role.company_id, role.id, permission.id
FROM erp_roles role CROSS JOIN erp_permissions permission
WHERE role.name IN ('System Administrator','Admin') AND permission.code IN ('sales.receipt.create','sales.receipt.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO erp_chart_of_accounts (company_id,account_code,account_name,account_type,level,is_postable,is_active)
SELECT company.id, account.code, account.name, account.type, 1, TRUE, TRUE
FROM erp_companies company
CROSS JOIN (VALUES
  ('1110','Cash on Hand','asset'),
  ('1120','M-Pesa Clearing','asset'),
  ('1130','Cheques in Transit','asset'),
  ('1140','Card Clearing','asset'),
  ('5300','Cash Over and Short','expense')
) AS account(code,name,type)
ON CONFLICT (company_id,account_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS erp_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  method_code TEXT NOT NULL CHECK (method_code IN ('cash','mpesa','bank_transfer','cheque','card')),
  display_name TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES erp_chart_of_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id,method_code)
);

INSERT INTO erp_payment_methods (company_id,method_code,display_name,account_id)
SELECT company.id, method.code, method.label, account.id
FROM erp_companies company
CROSS JOIN (VALUES
  ('cash','Cash','1110'),('mpesa','M-Pesa','1120'),('bank_transfer','Bank transfer','1100'),
  ('cheque','Cheque','1130'),('card','Card','1140')
) AS method(code,label,account_code)
JOIN erp_chart_of_accounts account ON account.company_id=company.id AND account.account_code=method.account_code
ON CONFLICT (company_id,method_code) DO NOTHING;

ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS clearing_status TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK (clearing_status IN ('not_applicable','in_transit','cleared'));
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS till_session_id UUID;
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE erp_receipt_allocations ALTER COLUMN invoice_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS erp_customer_receipts_reference_uq
  ON erp_customer_receipts(company_id,payment_method,reference_no)
  WHERE reference_no IS NOT NULL AND is_deleted=FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS erp_customer_receipts_idempotency_uq
  ON erp_customer_receipts(company_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL AND is_deleted=FALSE;

CREATE TABLE IF NOT EXISTS erp_pos_till_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  cashier_user_id UUID NOT NULL REFERENCES erp_users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_float NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closed_at TIMESTAMPTZ,
  expected_cash NUMERIC(18,2),
  counted_cash NUMERIC(18,2),
  variance NUMERIC(18,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_journal_id UUID REFERENCES erp_journals(id),
  closing_journal_id UUID REFERENCES erp_journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES erp_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_pos_till_one_open_per_cashier_uq
  ON erp_pos_till_sessions(company_id,cashier_user_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS erp_pos_till_cashier_open_idx
  ON erp_pos_till_sessions(company_id,cashier_user_id,opened_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_customer_receipts_till_session_fk') THEN
    ALTER TABLE erp_customer_receipts ADD CONSTRAINT erp_customer_receipts_till_session_fk
      FOREIGN KEY (till_session_id) REFERENCES erp_pos_till_sessions(id);
  END IF;
END $$;

INSERT INTO erp_system_settings (company_id,category,setting_key,setting_value,description)
SELECT id,'sales','receipt_approval_threshold','100000'::jsonb,
       'Receipt amounts above this KES threshold require independent approval'
FROM erp_companies
ON CONFLICT (company_id,category,setting_key) DO NOTHING;
