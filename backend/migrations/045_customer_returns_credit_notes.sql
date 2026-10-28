ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(18,4) NOT NULL DEFAULT 0;

ALTER TABLE erp_customer_invoices
  DROP CONSTRAINT IF EXISTS erp_customer_invoices_status_check;
ALTER TABLE erp_customer_invoices
  ADD CONSTRAINT erp_customer_invoices_status_check
  CHECK (status IN ('draft','posted','paid','partial','overdue','credited','cancelled'));

ALTER TABLE erp_inventory_lot_layers
  DROP CONSTRAINT IF EXISTS erp_inventory_lot_layers_source_type_check;
ALTER TABLE erp_inventory_lot_layers
  ADD CONSTRAINT erp_inventory_lot_layers_source_type_check
  CHECK (source_type IN ('supplier_receipt','transfer','material_return','customer_return','stock_adjustment','opening','legacy'));

CREATE TABLE IF NOT EXISTS erp_delivery_note_layer_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  delivery_note_line_id UUID NOT NULL REFERENCES erp_delivery_note_lines(id) ON DELETE CASCADE,
  layer_id UUID REFERENCES erp_inventory_lot_layers(id),
  batch_no TEXT,
  expiry_date DATE,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);
CREATE INDEX IF NOT EXISTS erp_delivery_note_layer_allocations_source_idx
  ON erp_delivery_note_layer_allocations(company_id, delivery_note_line_id, batch_no, expiry_date, created_at);

WITH unique_delivery_items AS (
  SELECT company_id, delivery_note_id, item_id, (ARRAY_AGG(id ORDER BY id))[1] AS delivery_note_line_id
  FROM erp_delivery_note_lines
  WHERE is_deleted = FALSE
  GROUP BY company_id, delivery_note_id, item_id
  HAVING COUNT(*) = 1
), historical_issues AS (
  SELECT company_id, reference_id AS delivery_note_id, item_id, batch_no, expiry_date,
         SUM(ABS(quantity)) AS quantity,
         CASE WHEN SUM(ABS(quantity)) > 0 THEN SUM(ABS(quantity) * unit_cost) / SUM(ABS(quantity)) ELSE 0 END AS unit_cost
  FROM erp_stock_ledger
  WHERE reference_type = 'delivery_note' AND movement_type = 'issue'
  GROUP BY company_id, reference_id, item_id, batch_no, expiry_date
)
INSERT INTO erp_delivery_note_layer_allocations
  (company_id, delivery_note_line_id, batch_no, expiry_date, quantity, unit_cost)
SELECT h.company_id, d.delivery_note_line_id, h.batch_no, h.expiry_date, h.quantity, h.unit_cost
FROM historical_issues h
JOIN unique_delivery_items d ON d.company_id = h.company_id AND d.delivery_note_id = h.delivery_note_id AND d.item_id = h.item_id
WHERE NOT EXISTS (
  SELECT 1 FROM erp_delivery_note_layer_allocations a
  WHERE a.delivery_note_line_id = d.delivery_note_line_id
);

CREATE TABLE IF NOT EXISTS erp_customer_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  invoice_id UUID NOT NULL REFERENCES erp_customer_invoices(id),
  customer_id UUID NOT NULL REFERENCES erp_customers(id),
  credit_note_no TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL,
  court_dispute_determined_on DATE,
  court_case_reference TEXT,
  subtotal NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  journal_id UUID REFERENCES erp_journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  posted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES erp_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES erp_users(id),
  UNIQUE (company_id, credit_note_no),
  CHECK ((court_dispute_determined_on IS NULL AND court_case_reference IS NULL)
      OR (court_dispute_determined_on IS NOT NULL AND court_case_reference IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS erp_customer_credit_note_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  credit_note_id UUID NOT NULL REFERENCES erp_customer_credit_notes(id) ON DELETE CASCADE,
  invoice_line_id UUID NOT NULL REFERENCES erp_customer_invoice_lines(id),
  delivery_note_line_id UUID NOT NULL REFERENCES erp_delivery_note_lines(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  source_layer_id UUID REFERENCES erp_inventory_lot_layers(id),
  batch_no TEXT,
  expiry_date DATE,
  condition TEXT NOT NULL CHECK (condition IN ('good','damaged')),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  tax_code TEXT NOT NULL,
  tax_treatment TEXT NOT NULL CHECK (tax_treatment IN ('standard','zero_rated','exempt','out_of_scope')),
  tax_rate NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  net_amount NUMERIC(18,4) NOT NULL CHECK (net_amount >= 0),
  tax_amount NUMERIC(18,4) NOT NULL CHECK (tax_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_customer_credit_notes_register_idx
  ON erp_customer_credit_notes(company_id, credit_date DESC, status);
CREATE INDEX IF NOT EXISTS erp_customer_credit_note_lines_source_idx
  ON erp_customer_credit_note_lines(company_id, invoice_line_id, delivery_note_line_id, source_layer_id);
