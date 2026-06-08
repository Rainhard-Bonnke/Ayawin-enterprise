-- Credit notes + data integrity constraints

CREATE TABLE IF NOT EXISTS erp_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  customer_id UUID NOT NULL REFERENCES erp_customers (id),
  invoice_id UUID REFERENCES erp_customer_invoices (id),
  credit_note_no TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  reason TEXT NOT NULL,
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  posted_at TIMESTAMPTZ,
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, credit_note_no)
);

CREATE TABLE IF NOT EXISTS erp_credit_note_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  credit_note_id UUID NOT NULL REFERENCES erp_credit_notes (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID REFERENCES erp_items (id),
  description TEXT,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (credit_note_id, line_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_company_tax_id_uidx
  ON erp_customers (company_id, tax_id)
  WHERE tax_id IS NOT NULL AND tax_id <> '' AND is_deleted = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS erp_vendors_company_tax_id_uidx
  ON erp_vendors (company_id, tax_id)
  WHERE tax_id IS NOT NULL AND tax_id <> '' AND is_deleted = FALSE;

ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'tax'
    CHECK (invoice_type IN ('tax', 'proforma'));
