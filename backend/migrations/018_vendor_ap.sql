-- Accounts Payable: vendor bills, payments, 3-way match linkage

CREATE TABLE IF NOT EXISTS erp_vendor_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  purchase_order_id UUID REFERENCES erp_purchase_orders (id),
  goods_receipt_id UUID REFERENCES erp_goods_receipts (id),
  bill_no TEXT NOT NULL,
  vendor_ref TEXT,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'paid', 'partial', 'overdue', 'cancelled')),
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'matched', 'variance', 'failed')),
  match_notes TEXT,
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  posted_at TIMESTAMPTZ,
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, bill_no)
);

CREATE TABLE IF NOT EXISTS erp_vendor_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  invoice_id UUID NOT NULL REFERENCES erp_vendor_invoices (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  po_line_id UUID REFERENCES erp_purchase_order_lines (id),
  grn_line_id UUID REFERENCES erp_goods_receipt_lines (id),
  quantity NUMERIC(18, 4) NOT NULL,
  unit_cost NUMERIC(18, 4) NOT NULL,
  po_quantity NUMERIC(18, 4),
  grn_quantity NUMERIC(18, 4),
  variance_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_vendor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  payment_no TEXT NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
  reference_no TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, payment_no)
);

CREATE TABLE IF NOT EXISTS erp_vendor_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  payment_id UUID NOT NULL REFERENCES erp_vendor_payments (id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES erp_vendor_invoices (id),
  amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS erp_vendor_invoices_vendor_idx ON erp_vendor_invoices (company_id, vendor_id, status);
CREATE INDEX IF NOT EXISTS erp_vendor_invoices_grn_idx ON erp_vendor_invoices (goods_receipt_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_vendor_invoices', 'erp_vendor_invoice_lines', 'erp_vendor_payments'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
