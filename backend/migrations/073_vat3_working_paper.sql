CREATE TABLE IF NOT EXISTS erp_vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  period_id UUID NOT NULL REFERENCES erp_fiscal_periods (id),
  return_no TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'locked')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  variance_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  variance_explanation TEXT,
  prepared_by UUID REFERENCES erp_users (id),
  prepared_at TIMESTAMPTZ,
  approved_by UUID REFERENCES erp_users (id),
  approved_at TIMESTAMPTZ,
  locked_by UUID REFERENCES erp_users (id),
  locked_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES erp_users (id),
  reopened_at TIMESTAMPTZ,
  reopen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, period_id),
  UNIQUE (company_id, return_no),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS erp_vat_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  return_id UUID NOT NULL REFERENCES erp_vat_returns (id) ON DELETE CASCADE,
  source_document_type TEXT NOT NULL CHECK (source_document_type IN (
    'customer_invoice', 'customer_credit_note', 'supplier_bill', 'supplier_return_credit'
  )),
  source_document_id UUID NOT NULL,
  source_document_line_id UUID,
  document_no TEXT NOT NULL,
  document_date DATE NOT NULL,
  tax_treatment TEXT,
  evidence_status TEXT,
  taxable_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  output_vat NUMERIC(18, 4) NOT NULL DEFAULT 0,
  claimable_input_vat NUMERIC(18, 4) NOT NULL DEFAULT 0,
  held_input_vat NUMERIC(18, 4) NOT NULL DEFAULT 0,
  non_claimable_input_vat NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_vat_returns_period_idx
  ON erp_vat_returns (company_id, period_start, period_end, status);
CREATE INDEX IF NOT EXISTS erp_vat_return_lines_source_idx
  ON erp_vat_return_lines (company_id, source_document_type, source_document_id);

CREATE OR REPLACE FUNCTION erp_prevent_locked_vat_period_posting()
RETURNS TRIGGER AS $$
DECLARE
  document_date DATE;
BEGIN
  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'erp_supplier_bills' THEN
    document_date := NEW.bill_date;
  ELSIF TG_TABLE_NAME = 'erp_customer_invoices' THEN
    document_date := NEW.invoice_date;
  ELSIF TG_TABLE_NAME = 'erp_customer_credit_notes' THEN
    document_date := NEW.credit_date;
  ELSIF TG_TABLE_NAME = 'erp_supplier_return_credit_notes' THEN
    document_date := NEW.received_date;
  ELSE
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM erp_vat_returns r
    WHERE r.company_id = NEW.company_id AND r.status = 'locked'
      AND document_date BETWEEN r.period_start AND r.period_end
  ) THEN
    RAISE EXCEPTION 'A VAT return is locked for the document date; reopen it with approval and a reason before posting'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS erp_supplier_bill_locked_vat_period ON erp_supplier_bills;
CREATE TRIGGER erp_supplier_bill_locked_vat_period
BEFORE INSERT OR UPDATE OF status ON erp_supplier_bills
FOR EACH ROW EXECUTE FUNCTION erp_prevent_locked_vat_period_posting();

DROP TRIGGER IF EXISTS erp_customer_invoice_locked_vat_period ON erp_customer_invoices;
CREATE TRIGGER erp_customer_invoice_locked_vat_period
BEFORE INSERT OR UPDATE OF status ON erp_customer_invoices
FOR EACH ROW EXECUTE FUNCTION erp_prevent_locked_vat_period_posting();

DROP TRIGGER IF EXISTS erp_customer_credit_locked_vat_period ON erp_customer_credit_notes;
CREATE TRIGGER erp_customer_credit_locked_vat_period
BEFORE INSERT OR UPDATE OF status ON erp_customer_credit_notes
FOR EACH ROW EXECUTE FUNCTION erp_prevent_locked_vat_period_posting();

DROP TRIGGER IF EXISTS erp_supplier_credit_locked_vat_period ON erp_supplier_return_credit_notes;
CREATE TRIGGER erp_supplier_credit_locked_vat_period
BEFORE INSERT OR UPDATE OF status ON erp_supplier_return_credit_notes
FOR EACH ROW EXECUTE FUNCTION erp_prevent_locked_vat_period_posting();

CREATE OR REPLACE FUNCTION erp_prevent_locked_vat_journal_line()
RETURNS TRIGGER AS $$
DECLARE
  journal_date DATE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM erp_chart_of_accounts a
    WHERE a.id = NEW.account_id AND a.company_id = NEW.company_id
      AND a.account_code IN ('1400', '1401', '2200')
  ) THEN
    RETURN NEW;
  END IF;
  SELECT entry_date INTO journal_date FROM erp_journals
  WHERE id = NEW.journal_id AND company_id = NEW.company_id;
  IF EXISTS (
    SELECT 1 FROM erp_vat_returns r
    WHERE r.company_id = NEW.company_id AND r.status = 'locked'
      AND journal_date BETWEEN r.period_start AND r.period_end
  ) THEN
    RAISE EXCEPTION 'A VAT return is locked for the journal date; reopen it with approval and a reason before posting'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS erp_locked_vat_journal_line ON erp_journal_lines;
CREATE TRIGGER erp_locked_vat_journal_line
BEFORE INSERT ON erp_journal_lines
FOR EACH ROW EXECUTE FUNCTION erp_prevent_locked_vat_journal_line();