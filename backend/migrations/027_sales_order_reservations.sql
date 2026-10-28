-- Confirmed sales orders reserve stock until it is delivered or explicitly released.
CREATE TABLE IF NOT EXISTS erp_sales_order_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  sales_order_id UUID NOT NULL REFERENCES erp_sales_orders (id) ON DELETE CASCADE,
  sales_order_line_id UUID NOT NULL UNIQUE REFERENCES erp_sales_order_lines (id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  item_id UUID NOT NULL REFERENCES erp_items (id),
  reserved_quantity NUMERIC(18, 4) NOT NULL CHECK (reserved_quantity > 0),
  fulfilled_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  released_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CHECK (fulfilled_quantity + released_quantity <= reserved_quantity)
);

CREATE INDEX IF NOT EXISTS erp_sales_order_reservations_available_idx
  ON erp_sales_order_reservations (company_id, warehouse_id, item_id)
  WHERE status = 'active';

-- Preserve outstanding confirmed orders when their total open quantity fits current stock.
WITH demand AS (
  SELECT so.company_id, so.warehouse_id, sol.item_id,
         SUM(GREATEST(sol.quantity - sol.qty_delivered, 0)) AS open_quantity
  FROM erp_sales_orders so
  JOIN erp_sales_order_lines sol ON sol.sales_order_id = so.id
  WHERE so.status IN ('confirmed', 'partial') AND so.is_deleted = FALSE
  GROUP BY so.company_id, so.warehouse_id, sol.item_id
), reservable AS (
  SELECT d.company_id, d.warehouse_id, d.item_id
  FROM demand d
  JOIN erp_stock_on_hand s
    ON s.company_id = d.company_id AND s.warehouse_id = d.warehouse_id AND s.item_id = d.item_id
  WHERE d.open_quantity <= s.quantity
)
INSERT INTO erp_sales_order_reservations
  (company_id, sales_order_id, sales_order_line_id, warehouse_id, item_id, reserved_quantity, fulfilled_quantity)
SELECT so.company_id, so.id, sol.id, so.warehouse_id, sol.item_id,
       sol.quantity, LEAST(sol.qty_delivered, sol.quantity)
FROM erp_sales_orders so
JOIN erp_sales_order_lines sol ON sol.sales_order_id = so.id
JOIN reservable r ON r.company_id = so.company_id AND r.warehouse_id = so.warehouse_id AND r.item_id = sol.item_id
WHERE so.status IN ('confirmed', 'partial') AND so.is_deleted = FALSE
  AND sol.quantity > sol.qty_delivered
ON CONFLICT (sales_order_line_id) DO NOTHING;
