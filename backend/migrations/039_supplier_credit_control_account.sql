INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, '1250', 'Unapplied Supplier Credits', 'asset', 2, TRUE, 'KES'
FROM erp_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '1250'
);

UPDATE erp_chart_of_accounts credit_asset
SET parent_id = assets.id
FROM erp_chart_of_accounts assets
WHERE credit_asset.company_id = assets.company_id
  AND credit_asset.account_code = '1250'
  AND assets.account_code = '1000'
  AND credit_asset.parent_id IS NULL;
