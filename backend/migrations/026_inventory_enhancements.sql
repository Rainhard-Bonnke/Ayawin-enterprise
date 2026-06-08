-- Adjustment reason codes, approver audit, non-negative on-hand guard

ALTER TABLE erp_stock_adjustments
  ADD COLUMN IF NOT EXISTS reason_code TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES erp_users (id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_stock_on_hand WHERE quantity < 0 LIMIT 1) THEN
    ALTER TABLE erp_stock_on_hand
      ADD CONSTRAINT erp_stock_on_hand_qty_non_negative CHECK (quantity >= 0);
  END IF;
END $$;
