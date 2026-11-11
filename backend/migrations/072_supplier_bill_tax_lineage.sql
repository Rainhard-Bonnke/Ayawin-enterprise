ALTER TABLE erp_supplier_bill_lines
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES erp_items (id),
  ADD COLUMN IF NOT EXISTS tax_group_id UUID REFERENCES erp_tax_groups (id);

UPDATE erp_supplier_bill_lines bl
SET item_id = grl.item_id,
    tax_group_id = item.tax_group_id
FROM erp_goods_receipt_lines grl
JOIN erp_items item ON item.id = grl.item_id AND item.company_id = grl.company_id
WHERE bl.goods_receipt_line_id = grl.id AND bl.company_id = grl.company_id
  AND (bl.item_id IS NULL OR bl.tax_group_id IS NULL);