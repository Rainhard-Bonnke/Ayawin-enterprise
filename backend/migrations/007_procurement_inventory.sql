-- Module 4: Procurement & Inventory

CREATE TABLE IF NOT EXISTS erp_purchase_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  branch_id UUID REFERENCES erp_branches (id),
  requisition_no TEXT NOT NULL,
  requester_id UUID REFERENCES erp_users (id),
  required_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'ordered')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, requisition_no)
);

CREATE TABLE IF NOT EXISTS erp_purchase_requisition_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  requisition_id UUID NOT NULL REFERENCES erp_purchase_requisitions (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  uom_id UUID REFERENCES erp_uom (id),
  estimated_unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  warehouse_id UUID REFERENCES erp_warehouses (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (requisition_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  warehouse_id UUID REFERENCES erp_warehouses (id),
  requisition_id UUID REFERENCES erp_purchase_requisitions (id),
  po_number TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'sent', 'partial', 'received', 'closed', 'cancelled')),
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, po_number)
);

CREATE INDEX IF NOT EXISTS erp_po_company_status_idx ON erp_purchase_orders (company_id, status);

CREATE TABLE IF NOT EXISTS erp_purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  purchase_order_id UUID NOT NULL REFERENCES erp_purchase_orders (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  qty_received NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (purchase_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  purchase_order_id UUID NOT NULL REFERENCES erp_purchase_orders (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  grn_number TEXT NOT NULL,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  posted_at TIMESTAMPTZ,
  posted_by UUID,
  journal_id UUID REFERENCES erp_journals (id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, grn_number)
);

CREATE TABLE IF NOT EXISTS erp_goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  goods_receipt_id UUID NOT NULL REFERENCES erp_goods_receipts (id) ON DELETE CASCADE,
  po_line_id UUID REFERENCES erp_purchase_order_lines (id),
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  batch_no TEXT,
  expiry_date DATE,
  bin_id UUID REFERENCES erp_warehouse_bins (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (goods_receipt_id, line_no)
);

-- Stock ledger (immutable movements)
CREATE TABLE IF NOT EXISTS erp_stock_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment', 'sale', 'return')),
  quantity NUMERIC(18, 4) NOT NULL,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id UUID,
  batch_no TEXT,
  expiry_date DATE,
  movement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS erp_stock_ledger_item_wh_idx
  ON erp_stock_ledger (company_id, item_id, warehouse_id, movement_date DESC);

-- On-hand balances (maintained on post)
CREATE TABLE IF NOT EXISTS erp_stock_on_hand (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  avg_unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, warehouse_id, item_id)
);

CREATE TABLE IF NOT EXISTS erp_stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  transfer_no TEXT NOT NULL,
  from_warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  to_warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  posted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, transfer_no)
);

CREATE TABLE IF NOT EXISTS erp_stock_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  transfer_id UUID NOT NULL REFERENCES erp_stock_transfers (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (transfer_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  adjustment_no TEXT NOT NULL,
  adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  posted_at TIMESTAMPTZ,
  journal_id UUID REFERENCES erp_journals (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, adjustment_no)
);

CREATE TABLE IF NOT EXISTS erp_stock_adjustment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  adjustment_id UUID NOT NULL REFERENCES erp_stock_adjustments (id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity_delta NUMERIC(18, 4) NOT NULL,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (adjustment_id, line_no)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_purchase_requisitions', 'erp_purchase_requisition_lines', 'erp_purchase_orders',
    'erp_purchase_order_lines', 'erp_goods_receipts', 'erp_goods_receipt_lines',
    'erp_stock_on_hand', 'erp_stock_transfers', 'erp_stock_transfer_lines',
    'erp_stock_adjustments', 'erp_stock_adjustment_lines'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
