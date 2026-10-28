CREATE TABLE IF NOT EXISTS erp_bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  bank_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  statement_reference TEXT NOT NULL,
  statement_start DATE NOT NULL,
  statement_end DATE NOT NULL,
  opening_balance NUMERIC(18, 4) NOT NULL,
  closing_balance NUMERIC(18, 4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reconciled')),
  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  CHECK (statement_end >= statement_start),
  UNIQUE (company_id, bank_account_id, statement_reference)
);

CREATE TABLE IF NOT EXISTS erp_bank_reconciliation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  reconciliation_id UUID NOT NULL REFERENCES erp_bank_reconciliations (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  transaction_date DATE NOT NULL,
  reference TEXT,
  description TEXT NOT NULL DEFAULT '',
  debit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  journal_line_id UUID REFERENCES erp_journal_lines (id),
  matched_at TIMESTAMPTZ,
  matched_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  UNIQUE (reconciliation_id, line_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_bank_reconciliation_journal_line_uq
  ON erp_bank_reconciliation_lines (journal_line_id)
  WHERE journal_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS erp_bank_reconciliations_company_date_idx
  ON erp_bank_reconciliations (company_id, statement_end DESC);

CREATE INDEX IF NOT EXISTS erp_bank_reconciliation_lines_statement_idx
  ON erp_bank_reconciliation_lines (company_id, reconciliation_id, transaction_date);
