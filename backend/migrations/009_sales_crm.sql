-- Module 5: Sales & CRM

-- CRM
CREATE TABLE IF NOT EXISTS erp_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  lead_no TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
  assigned_to UUID REFERENCES erp_users (id),
  estimated_value NUMERIC(18, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, lead_no)
);

CREATE TABLE IF NOT EXISTS erp_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  lead_id UUID REFERENCES erp_leads (id),
  customer_id UUID REFERENCES erp_customers (id),
  opportunity_no TEXT NOT NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'prospecting'
    CHECK (stage IN ('prospecting', 'qualification', 'proposal', 'negotiation', 'won', 'lost')),
  probability NUMERIC(5, 2) NOT NULL DEFAULT 0,
  expected_close_date DATE,
  amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, opportunity_no)
);

CREATE TABLE IF NOT EXISTS erp_crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  lead_id UUID REFERENCES erp_leads (id),
  opportunity_id UUID REFERENCES erp_opportunities (id),
  customer_id UUID REFERENCES erp_customers (id),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('call', 'email', 'meeting', 'task', 'note')),
  subject TEXT NOT NULL,
  description TEXT,
  activity_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to UUID REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- Sales documents
CREATE TABLE IF NOT EXISTS erp_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  customer_id UUID NOT NULL REFERENCES erp_customers (id),
  opportunity_id UUID REFERENCES erp_opportunities (id),
  quote_no TEXT NOT NULL,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, quote_no)
);

CREATE TABLE IF NOT EXISTS erp_quotation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  quotation_id UUID NOT NULL REFERENCES erp_quotations (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (quotation_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  customer_id UUID NOT NULL REFERENCES erp_customers (id),
  quotation_id UUID REFERENCES erp_quotations (id),
  warehouse_id UUID REFERENCES erp_warehouses (id),
  price_list_id UUID REFERENCES erp_price_lists (id),
  order_no TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  required_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'partial', 'delivered', 'invoiced', 'cancelled')),
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  credit_check_passed BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, order_no)
);

CREATE TABLE IF NOT EXISTS erp_sales_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  sales_order_id UUID NOT NULL REFERENCES erp_sales_orders (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  qty_delivered NUMERIC(18, 4) NOT NULL DEFAULT 0,
  qty_invoiced NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (sales_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  sales_order_id UUID NOT NULL REFERENCES erp_sales_orders (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  delivery_no TEXT NOT NULL,
  delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  posted_at TIMESTAMPTZ,
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, delivery_no)
);

CREATE TABLE IF NOT EXISTS erp_delivery_note_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  delivery_note_id UUID NOT NULL REFERENCES erp_delivery_notes (id) ON DELETE CASCADE,
  so_line_id UUID REFERENCES erp_sales_order_lines (id),
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (delivery_note_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_customer_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  customer_id UUID NOT NULL REFERENCES erp_customers (id),
  sales_order_id UUID REFERENCES erp_sales_orders (id),
  delivery_note_id UUID REFERENCES erp_delivery_notes (id),
  invoice_no TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'paid', 'partial', 'overdue', 'cancelled')),
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  posted_at TIMESTAMPTZ,
  journal_id UUID REFERENCES erp_journals (id),
  etims_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS erp_customer_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  invoice_id UUID NOT NULL REFERENCES erp_customer_invoices (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL,
  unit_price NUMERIC(18, 4) NOT NULL,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_customer_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  customer_id UUID NOT NULL REFERENCES erp_customers (id),
  receipt_no TEXT NOT NULL,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'bank',
  reference_no TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, receipt_no)
);

CREATE TABLE IF NOT EXISTS erp_receipt_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  receipt_id UUID NOT NULL REFERENCES erp_customer_receipts (id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES erp_customer_invoices (id),
  amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_leads', 'erp_opportunities', 'erp_crm_activities', 'erp_quotations', 'erp_quotation_lines',
    'erp_sales_orders', 'erp_sales_order_lines', 'erp_delivery_notes', 'erp_delivery_note_lines',
    'erp_customer_invoices', 'erp_customer_invoice_lines', 'erp_customer_receipts'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
