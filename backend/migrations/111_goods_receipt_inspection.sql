ALTER TABLE erp_goods_receipt_lines
  ADD COLUMN IF NOT EXISTS inspection_status TEXT NOT NULL DEFAULT 'accept'
    CHECK (inspection_status IN ('accept', 'quarantine', 'reject')),
  ADD COLUMN IF NOT EXISTS inspection_reason TEXT;

ALTER TABLE erp_goods_receipt_lines
  ADD CONSTRAINT erp_goods_receipt_inspection_reason_chk
  CHECK (inspection_status = 'accept' OR NULLIF(BTRIM(inspection_reason), '') IS NOT NULL);