ALTER TABLE erp_goods_receipt_lines
  ADD COLUMN IF NOT EXISTS landed_cost_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS unit_weight NUMERIC(18, 6);

CREATE TABLE IF NOT EXISTS erp_goods_receipt_landed_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  goods_receipt_id UUID NOT NULL REFERENCES erp_goods_receipts (id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  credit_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  allocation_method TEXT NOT NULL CHECK (allocation_method IN ('value', 'quantity', 'weight')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id)
);

CREATE INDEX IF NOT EXISTS erp_goods_receipt_landed_costs_receipt_idx
  ON erp_goods_receipt_landed_costs (company_id, goods_receipt_id);