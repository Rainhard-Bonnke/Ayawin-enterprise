ALTER TABLE erp_purchase_orders
  ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS erp_rfq_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  requisition_id UUID REFERENCES erp_purchase_requisitions (id),
  rfq_no TEXT NOT NULL,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'open', 'awarded', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, rfq_no)
);

CREATE TABLE IF NOT EXISTS erp_rfq_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  rfq_id UUID NOT NULL REFERENCES erp_rfq_headers (id) ON DELETE CASCADE,
  requisition_line_id UUID REFERENCES erp_purchase_requisition_lines (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  line_no INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (rfq_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_rfq_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  rfq_id UUID NOT NULL REFERENCES erp_rfq_headers (id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'sent', 'quoted', 'awarded')),
  UNIQUE (rfq_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS erp_rfq_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  rfq_id UUID NOT NULL REFERENCES erp_rfq_headers (id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  quote_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'accepted', 'awarded', 'rejected')),
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_at TIMESTAMPTZ,
  awarded_by UUID,
  justification TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS erp_rfq_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  quote_id UUID NOT NULL REFERENCES erp_rfq_quotes (id) ON DELETE CASCADE,
  rfq_line_id UUID NOT NULL REFERENCES erp_rfq_lines (id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quote_id, rfq_line_id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_order_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  purchase_order_id UUID NOT NULL REFERENCES erp_purchase_orders (id) ON DELETE CASCADE,
  amendment_no TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'approved', 'rejected')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_order_id, version_no)
);

CREATE TABLE IF NOT EXISTS erp_purchase_order_amendment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  amendment_id UUID NOT NULL REFERENCES erp_purchase_order_amendments (id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  goods_receipt_id UUID NOT NULL REFERENCES erp_goods_receipts (id),
  return_no TEXT NOT NULL,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'dispatched', 'completed', 'rejected', 'cancelled')),
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_by UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, return_no)
);

CREATE TABLE IF NOT EXISTS erp_purchase_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  purchase_return_id UUID NOT NULL REFERENCES erp_purchase_returns (id) ON DELETE CASCADE,
  goods_receipt_line_id UUID NOT NULL REFERENCES erp_goods_receipt_lines (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
