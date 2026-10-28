CREATE TABLE IF NOT EXISTS erp_supplier_return_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  disposition_id UUID NOT NULL REFERENCES erp_inventory_dispositions(id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors(id),
  credit_note_no TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_no TEXT,
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  journal_id UUID REFERENCES erp_journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  posted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES erp_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES erp_users(id),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, vendor_id, credit_note_no)
);

CREATE TABLE IF NOT EXISTS erp_supplier_return_credit_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  credit_note_id UUID NOT NULL REFERENCES erp_supplier_return_credit_notes(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES erp_supplier_bills(id),
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE (credit_note_id, bill_id)
);

CREATE INDEX IF NOT EXISTS erp_supplier_return_credit_register_idx
  ON erp_supplier_return_credit_notes(company_id, status, created_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS erp_supplier_return_credit_disposition_idx
  ON erp_supplier_return_credit_notes(company_id, disposition_id, status)
  WHERE is_deleted = FALSE;
