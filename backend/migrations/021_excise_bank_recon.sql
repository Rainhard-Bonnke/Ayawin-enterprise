-- Excise columns, item litres, bank reconciliation

ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS litres_per_unit NUMERIC(18, 6) NOT NULL DEFAULT 0;

UPDATE erp_items i
SET litres_per_unit = v.litres
FROM erp_companies c
JOIN (
  VALUES
    ('TSK-500', 0.5),
    ('GNS-500', 0.5),
    ('JW-RED', 0.75),
    ('COKE-500', 0.5),
    ('DSN-1L', 1.0)
) AS v(item_code, litres) ON TRUE
WHERE i.company_id = c.id AND c.code = 'MARTIN' AND i.item_code = v.item_code;

ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS excise_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE erp_customer_invoice_lines
  ADD COLUMN IF NOT EXISTS excise_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE erp_credit_notes
  ADD COLUMN IF NOT EXISTS excise_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE erp_sales_orders
  ADD COLUMN IF NOT EXISTS excise_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, '2300', 'Excise Duty Payable', 'liability', 2, TRUE, 'KES'
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '2300'
  );

UPDATE erp_chart_of_accounts child
SET parent_id = parent.id
FROM erp_chart_of_accounts parent
JOIN erp_companies c ON c.id = parent.company_id AND c.code = 'MARTIN'
WHERE child.company_id = c.id
  AND child.account_code = '2300'
  AND child.parent_id IS NULL
  AND parent.account_code = '2000';

CREATE TABLE IF NOT EXISTS erp_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  gl_account_id UUID REFERENCES erp_chart_of_accounts (id),
  name TEXT NOT NULL,
  account_number TEXT,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS erp_bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  bank_account_id UUID NOT NULL REFERENCES erp_bank_accounts (id),
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  reference_no TEXT,
  amount NUMERIC(18, 4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'matched', 'ignored')),
  matched_receipt_id UUID REFERENCES erp_customer_receipts (id),
  matched_journal_id UUID REFERENCES erp_journals (id),
  matched_at TIMESTAMPTZ,
  matched_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_bank_stmt_company_status
  ON erp_bank_statement_lines (company_id, bank_account_id, status);

INSERT INTO erp_bank_accounts (company_id, gl_account_id, name, account_number)
SELECT c.id, a.id, 'Main Operating Account', 'MARTIN-OPS-001'
FROM erp_companies c
JOIN erp_chart_of_accounts a ON a.company_id = c.id AND a.account_code = '1100'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_bank_accounts b WHERE b.company_id = c.id AND b.name = 'Main Operating Account');
