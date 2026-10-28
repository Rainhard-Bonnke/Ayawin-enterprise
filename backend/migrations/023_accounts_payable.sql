CREATE TABLE IF NOT EXISTS erp_supplier_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  purchase_order_id UUID REFERENCES erp_purchase_orders (id),
  goods_receipt_id UUID REFERENCES erp_goods_receipts (id),
  bill_no TEXT NOT NULL,
  supplier_invoice_no TEXT NOT NULL,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'posting', 'posted', 'partial', 'paid', 'overdue', 'cancelled')),
  notes TEXT,
  journal_id UUID REFERENCES erp_journals (id),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, bill_no),
  UNIQUE (company_id, vendor_id, supplier_invoice_no)
);

CREATE TABLE IF NOT EXISTS erp_supplier_bill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  bill_id UUID NOT NULL REFERENCES erp_supplier_bills (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  net_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  UNIQUE (bill_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  payment_no TEXT NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'bank',
  reference_no TEXT,
  bank_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posting', 'posted', 'voided')),
  journal_id UUID REFERENCES erp_journals (id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, payment_no)
);

CREATE TABLE IF NOT EXISTS erp_supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  payment_id UUID NOT NULL REFERENCES erp_supplier_payments (id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES erp_supplier_bills (id),
  amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  UNIQUE (payment_id, bill_id)
);

CREATE INDEX IF NOT EXISTS erp_supplier_bills_due_idx
  ON erp_supplier_bills (company_id, due_date, status) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS erp_supplier_bills_vendor_idx
  ON erp_supplier_bills (company_id, vendor_id, bill_date DESC) WHERE is_deleted = FALSE;

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, '1400', 'VAT Input', 'asset', 2, TRUE, 'KES'
FROM erp_companies c
WHERE NOT EXISTS (SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '1400');

UPDATE erp_chart_of_accounts child
SET parent_id = parent.id
FROM erp_chart_of_accounts parent
WHERE child.company_id = parent.company_id
  AND parent.account_code = '1000'
  AND child.account_code = '1400'
  AND child.parent_id IS NULL;

DROP TRIGGER IF EXISTS trg_erp_supplier_bills_updated_at ON erp_supplier_bills;
CREATE TRIGGER trg_erp_supplier_bills_updated_at BEFORE UPDATE ON erp_supplier_bills
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();
