CREATE TABLE IF NOT EXISTS erp_mpesa_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  statement_reference TEXT NOT NULL,
  file_name TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  imported_by UUID NOT NULL REFERENCES erp_users (id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, statement_reference)
);

CREATE TABLE IF NOT EXISTS erp_mpesa_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  import_id UUID NOT NULL REFERENCES erp_mpesa_statement_imports (id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  transaction_id TEXT,
  transaction_date DATE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('payment','deposit','fee','reversal')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  reference TEXT,
  mpesa_transaction_id UUID REFERENCES erp_mpesa_transactions (id),
  bank_statement_line_id UUID REFERENCES erp_bank_reconciliation_lines (id),
  journal_id UUID REFERENCES erp_journals (id),
  status TEXT NOT NULL CHECK (status IN ('matched','unmatched','posted','duplicate')),
  variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (import_id,line_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_mpesa_statement_transaction_dedupe_idx
  ON erp_mpesa_statement_lines (company_id,transaction_id)
  WHERE transaction_id IS NOT NULL AND status <> 'duplicate';