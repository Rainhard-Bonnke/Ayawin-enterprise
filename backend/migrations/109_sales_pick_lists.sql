CREATE TABLE IF NOT EXISTS erp_sales_pick_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  sales_order_id UUID NOT NULL REFERENCES erp_sales_orders (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  pick_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'picked', 'fulfilled', 'cancelled')),
  picked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id),
  picked_by UUID REFERENCES erp_users (id),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, pick_no)
);

CREATE INDEX IF NOT EXISTS erp_sales_pick_lists_order_idx
  ON erp_sales_pick_lists (company_id, sales_order_id, status)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_sales_pick_list_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  pick_list_id UUID NOT NULL REFERENCES erp_sales_pick_lists (id) ON DELETE CASCADE,
  sales_order_line_id UUID NOT NULL REFERENCES erp_sales_order_lines (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  quantity_to_pick NUMERIC(18, 4) NOT NULL CHECK (quantity_to_pick > 0),
  quantity_picked NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
  quantity_delivered NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity_picked <= quantity_to_pick),
  CHECK (quantity_delivered <= quantity_picked),
  UNIQUE (pick_list_id, sales_order_line_id)
);

ALTER TABLE erp_delivery_notes
  ADD COLUMN IF NOT EXISTS pick_list_id UUID REFERENCES erp_sales_pick_lists (id);