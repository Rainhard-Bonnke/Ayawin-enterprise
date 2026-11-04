-- Module 2 seed for Martin Beverages Ltd

-- Payment terms
INSERT INTO erp_payment_terms (company_id, code, name, due_days, discount_percent, discount_days)
SELECT c.id, v.code, v.name, v.days, v.disc, v.disc_days
FROM erp_companies c
CROSS JOIN (VALUES
  ('NET15', 'Net 15 Days', 15, 0, 0),
  ('NET30', 'Net 30 Days', 30, 0, 0),
  ('NET45', 'Net 45 Days', 45, 0, 0),
  ('2/10NET30', '2% 10 Net 30', 30, 2, 10)
) AS v(code, name, days, disc, disc_days)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_payment_terms pt WHERE pt.company_id = c.id AND pt.code = v.code);

-- Tax rates
INSERT INTO erp_tax_rates (company_id, code, name, rate, tax_type, basis)
SELECT c.id, v.code, v.name, v.rate, v.tax_type, v.basis
FROM erp_companies c
CROSS JOIN (VALUES
  ('VAT16', 'VAT 16%', 16.000000, 'vat', 'percentage'),
  ('WHT5', 'Withholding 5%', 5.000000, 'withholding', 'percentage'),
  ('EXC-BEER', 'Beer Excise per Litre', 121.850000, 'excise', 'per_unit'),
  ('EXC-SPIRITS', 'Spirits Excise per Litre', 356.280000, 'excise', 'per_unit')
) AS v(code, name, rate, tax_type, basis)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_tax_rates tr WHERE tr.company_id = c.id AND tr.code = v.code);

INSERT INTO erp_tax_groups (company_id, code, name)
SELECT c.id, v.code, v.name
FROM erp_companies c
CROSS JOIN (VALUES
  ('STD-VAT', 'Standard VAT 16%'),
  ('ZERO', 'Zero Rated'),
  ('EXEMPT', 'Exempt')
) AS v(code, name)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_tax_groups tg WHERE tg.company_id = c.id AND tg.code = v.code);

INSERT INTO erp_tax_group_rates (company_id, tax_group_id, tax_rate_id)
SELECT tg.company_id, tg.id, tr.id
FROM erp_tax_groups tg
JOIN erp_companies c ON c.id = tg.company_id AND c.code = 'MARTIN'
JOIN erp_tax_rates tr ON tr.company_id = c.id AND tr.code = 'VAT16'
WHERE tg.code = 'STD-VAT'
  AND NOT EXISTS (
    SELECT 1 FROM erp_tax_group_rates x WHERE x.tax_group_id = tg.id AND x.tax_rate_id = tr.id
  );

-- Chart of accounts
INSERT INTO erp_chart_of_accounts (company_id, account_code, account_name, account_type, level, is_postable, currency_code)
SELECT c.id, v.code, v.name, v.type, v.lvl, v.postable, 'KES'
FROM erp_companies c
CROSS JOIN (VALUES
  ('1000', 'Assets', 'asset', 1, FALSE),
  ('1100', 'Cash at Bank', 'asset', 2, TRUE),
  ('1200', 'Accounts Receivable', 'asset', 2, TRUE),
  ('1300', 'Inventory', 'asset', 2, TRUE),
  ('2000', 'Liabilities', 'liability', 1, FALSE),
  ('2100', 'Accounts Payable', 'liability', 2, TRUE),
  ('2200', 'VAT Output', 'liability', 2, TRUE),
  ('3000', 'Equity', 'equity', 1, FALSE),
  ('4000', 'Sales Revenue', 'income', 1, TRUE),
  ('5000', 'Cost of Goods Sold', 'expense', 1, TRUE),
  ('6000', 'Operating Expenses', 'expense', 1, FALSE)
) AS v(code, name, type, lvl, postable)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id = c.id AND a.account_code = v.code);

UPDATE erp_chart_of_accounts child
SET parent_id = parent.id
FROM erp_chart_of_accounts parent
JOIN erp_companies c ON c.id = parent.company_id AND c.code = 'MARTIN'
WHERE child.company_id = c.id
  AND child.parent_id IS NULL
  AND child.level > 1
  AND parent.company_id = c.id
  AND parent.account_code = CASE
    WHEN child.account_code LIKE '11%' OR child.account_code LIKE '12%' OR child.account_code LIKE '13%' THEN '1000'
    WHEN child.account_code LIKE '21%' OR child.account_code LIKE '22%' THEN '2000'
    ELSE NULL
  END;

-- UoM
INSERT INTO erp_uom (company_id, code, name)
SELECT c.id, v.code, v.name
FROM erp_companies c
CROSS JOIN (VALUES ('EA', 'Each'), ('CS', 'Case'), ('L', 'Litre'), ('KG', 'Kilogram')) AS v(code, name)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_uom u WHERE u.company_id = c.id AND u.code = v.code);

-- Item categories
INSERT INTO erp_item_categories (company_id, code, name)
SELECT c.id, v.code, v.name
FROM erp_companies c
CROSS JOIN (VALUES
  ('BEER', 'Beer'), ('SPIRITS', 'Spirits'), ('WINE', 'Wine'),
  ('SOFT', 'Soft Drinks'), ('WATER', 'Water'), ('JUICE', 'Juice')
) AS v(code, name)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_item_categories ic WHERE ic.company_id = c.id AND ic.code = v.code);

-- Generic categories and setup only; tenant inventory is loaded from the demo seed on demand.
