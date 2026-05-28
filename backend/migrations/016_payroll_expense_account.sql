-- Postable payroll expense account (parent 6000 is summary-only)
INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code, parent_id)
SELECT c.id, '6100', 'Salaries & Wages', 'expense', 2, TRUE, 'KES', p.id
FROM erp_companies c
JOIN erp_chart_of_accounts p ON p.company_id = c.id AND p.account_code = '6000'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = '6100'
  );
