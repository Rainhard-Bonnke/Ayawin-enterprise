ALTER TABLE erp_stock_transfers
  DROP CONSTRAINT IF EXISTS erp_stock_transfers_status_check;

ALTER TABLE erp_stock_transfers
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_by UUID,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by UUID,
  ADD COLUMN IF NOT EXISTS receipt_notes TEXT;

UPDATE erp_stock_transfers
SET status = 'received',
    dispatched_at = COALESCE(dispatched_at, posted_at),
    received_at = COALESCE(received_at, posted_at)
WHERE status = 'posted';

ALTER TABLE erp_stock_transfers
  ADD CONSTRAINT erp_stock_transfers_status_check
  CHECK (status IN ('draft', 'in_transit', 'partially_received', 'received', 'received_with_variance', 'cancelled'));

ALTER TABLE erp_stock_transfer_lines
  ADD COLUMN IF NOT EXISTS batch_no TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_complete BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE erp_stock_transfer_lines l
SET received_quantity = l.quantity,
    receipt_complete = TRUE,
    unit_cost = COALESCE((
      SELECT s.avg_unit_cost FROM erp_stock_on_hand s
      WHERE s.company_id = l.company_id AND s.item_id = l.item_id
        AND s.warehouse_id = t.to_warehouse_id
    ), 0)
FROM erp_stock_transfers t
WHERE t.id = l.transfer_id AND t.status = 'received' AND l.receipt_complete = FALSE;

CREATE INDEX IF NOT EXISTS erp_stock_transfers_in_transit_idx
  ON erp_stock_transfers (company_id, status, created_at DESC)
  WHERE is_deleted = FALSE;
