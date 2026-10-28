ALTER TABLE erp_supplier_bill_lines
  ADD COLUMN IF NOT EXISTS goods_receipt_line_id UUID REFERENCES erp_goods_receipt_lines (id);

CREATE INDEX IF NOT EXISTS erp_supplier_bill_lines_receipt_idx
  ON erp_supplier_bill_lines (company_id, goods_receipt_line_id)
  WHERE goods_receipt_line_id IS NOT NULL;

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, '2150', 'Goods Received Not Invoiced', 'liability', 2, TRUE, 'KES'
FROM erp_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM erp_chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_code = '2150'
);

UPDATE erp_chart_of_accounts accrual
SET parent_id = liabilities.id
FROM erp_chart_of_accounts liabilities
WHERE accrual.company_id = liabilities.company_id
  AND accrual.account_code = '2150'
  AND liabilities.account_code = '2000'
  AND accrual.parent_id IS NULL;
