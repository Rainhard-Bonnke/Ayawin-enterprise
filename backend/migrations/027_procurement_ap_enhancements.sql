-- Procurement/AP: vendor balance, landed cost on GRN, PO amendment tracking

ALTER TABLE erp_vendors
  ADD COLUMN IF NOT EXISTS ap_balance NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE erp_goods_receipts
  ADD COLUMN IF NOT EXISTS landed_cost_total NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE erp_purchase_orders
  ADD COLUMN IF NOT EXISTS revision_no INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amended_by UUID REFERENCES erp_users (id);
