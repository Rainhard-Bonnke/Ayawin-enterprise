-- Kenya distributor COA extensions (excise, payroll sub-accounts)

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code, parent_id)
SELECT c.id, '2300', 'Excise Duty Payable', 'liability', 2, TRUE, 'KES', p.id
FROM erp_companies c
JOIN erp_chart_of_accounts p ON p.company_id = c.id AND p.account_code = '2000'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '2300');

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code, parent_id)
SELECT c.id, '2400', 'PAYE / Withholding Payable', 'liability', 2, TRUE, 'KES', p.id
FROM erp_companies c
JOIN erp_chart_of_accounts p ON p.company_id = c.id AND p.account_code = '2000'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '2400');

INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code, parent_id)
SELECT c.id, '3100', 'Retained Earnings', 'equity', 2, TRUE, 'KES', p.id
FROM erp_companies c
JOIN erp_chart_of_accounts p ON p.company_id = c.id AND p.account_code = '3000'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '3100');
