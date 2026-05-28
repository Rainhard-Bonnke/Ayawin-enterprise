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

-- Items (sample from legacy products)
INSERT INTO erp_items (company_id, category_id, tax_group_id, uom_id, item_code, name, cost_method, standard_cost, reorder_point)
SELECT c.id, cat.id, tg.id, uom.id, v.sku, v.name, 'weighted_average', v.cost, v.min_stock
FROM erp_companies c
CROSS JOIN (VALUES
  ('TSK-500', 'Tusker Lager 500ml', 'BEER', 180, 200),
  ('GNS-500', 'Guinness Stout 500ml', 'BEER', 220, 100),
  ('JW-RED', 'Johnnie Walker Red 750ml', 'SPIRITS', 1850, 50),
  ('COKE-500', 'Coca-Cola 500ml', 'SOFT', 40, 500),
  ('DSN-1L', 'Dasani Water 1L', 'WATER', 45, 250)
) AS v(sku, name, cat_code, cost, min_stock)
JOIN erp_item_categories cat ON cat.company_id = c.id AND cat.code = v.cat_code
JOIN erp_tax_groups tg ON tg.company_id = c.id AND tg.code = 'STD-VAT'
JOIN erp_uom uom ON uom.company_id = c.id AND uom.code = 'EA'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_items i WHERE i.company_id = c.id AND i.item_code = v.sku);

-- Customers
INSERT INTO erp_customers (company_id, payment_terms_id, currency_code, customer_code, name, tax_id, email, city, credit_limit, customer_type)
SELECT c.id, pt.id, 'KES', v.code, v.name, v.tax_id, v.email, v.city, v.credit_lim, v.ctype
FROM erp_companies c
JOIN erp_payment_terms pt ON pt.company_id = c.id AND pt.code = 'NET30'
CROSS JOIN (VALUES
  ('C001', 'Brew Bistro Westlands', 'P051234567A', 'orders@brewbistro.co.ke', 'Nairobi', 500000, 'Bar/Restaurant'),
  ('C002', 'Naivas Supermarket Karen', 'P051234568B', 'procurement@naivas.co.ke', 'Nairobi', 2000000, 'Supermarket'),
  ('C003', 'Mombasa Liquor Distributors', 'P051234573G', 'ops@mld.co.ke', 'Mombasa', 3000000, 'Distributor')
) AS v(code, name, tax_id, email, city, credit_lim, ctype)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_customers cu WHERE cu.company_id = c.id AND cu.customer_code = v.code);

-- Vendors
INSERT INTO erp_vendors (company_id, payment_terms_id, currency_code, vendor_code, name, tax_id, email, credit_limit)
SELECT c.id, pt.id, 'KES', v.code, v.name, v.tax_id, v.email, v.credit_lim
FROM erp_companies c
JOIN erp_payment_terms pt ON pt.company_id = c.id AND pt.code = 'NET30'
CROSS JOIN (VALUES
  ('V001', 'East African Breweries Ltd', 'P051000001A', 'trade@eabl.com', 10000000),
  ('V002', 'Coca-Cola Beverages Africa', 'P051000004D', 'kenya@ccba.africa', 6000000),
  ('V003', 'Diageo Kenya', 'P051000005E', 'trade.ke@diageo.com', 7000000)
) AS v(code, name, tax_id, email, credit_lim)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_vendors ve WHERE ve.company_id = c.id AND ve.vendor_code = v.code);

-- Warehouses
INSERT INTO erp_warehouses (company_id, branch_id, code, name, city, manager_name)
SELECT c.id, b.id, v.code, v.name, v.city, v.mgr
FROM erp_companies c
CROSS JOIN (VALUES
  ('WH-NRB', 'Nairobi Main Warehouse', 'Nairobi', 'James Mwangi', 'HQ'),
  ('WH-MBA', 'Mombasa Warehouse', 'Mombasa', 'Aisha Mohamed', 'MBA'),
  ('WH-KSM', 'Kisumu Warehouse', 'Kisumu', 'Peter Otieno', 'KSM')
) AS v(code, name, city, mgr, branch_code)
JOIN erp_branches b ON b.company_id = c.id AND b.code = v.branch_code
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_warehouses w WHERE w.company_id = c.id AND w.code = v.code);

INSERT INTO erp_warehouse_bins (company_id, warehouse_id, code, aisle, rack)
SELECT w.company_id, w.id, v.bin, v.aisle, v.rack
FROM erp_warehouses w
JOIN erp_companies c ON c.id = w.company_id AND c.code = 'MARTIN'
CROSS JOIN (VALUES ('A-01-01', 'A', '01'), ('A-01-02', 'A', '01'), ('B-02-01', 'B', '02')) AS v(bin, aisle, rack)
WHERE w.code = 'WH-NRB'
  AND NOT EXISTS (SELECT 1 FROM erp_warehouse_bins b WHERE b.warehouse_id = w.id AND b.code = v.bin);

-- Employees (20 total: admin + 19 more)
INSERT INTO erp_employees (company_id, branch_id, employee_code, first_name, last_name, email, department, job_title, employment_type, hire_date, basic_salary)
SELECT c.id, b.id, v.code, v.fname, v.lname, v.email, v.dept, v.title, v.etype, v.hire::date, v.salary
FROM erp_companies c
JOIN erp_branches b ON b.company_id = c.id AND b.code = 'HQ'
CROSS JOIN (VALUES
  ('E001', 'Admin', 'User', 'admin@martin.co.ke', 'Executive', 'CEO', 'permanent', '2020-01-01', 450000),
  ('E002', 'Grace', 'Wanjiku', 'manager@martin.co.ke', 'Sales', 'Sales Manager', 'permanent', '2021-03-15', 180000),
  ('E003', 'Brian', 'Otieno', 'sales1@martin.co.ke', 'Sales', 'Senior Sales Rep', 'permanent', '2022-06-01', 95000),
  ('E004', 'Faith', 'Achieng', 'warehouse1@martin.co.ke', 'Warehouse', 'Supervisor', 'permanent', '2021-08-10', 78000),
  ('E005', 'Daniel', 'Kiprop', 'account1@martin.co.ke', 'Finance', 'Accountant', 'permanent', '2020-11-01', 120000),
  ('E006', 'Samuel', 'Njoroge', 'driver1@martin.co.ke', 'Logistics', 'Driver', 'permanent', '2023-01-20', 45000),
  ('E007', 'Alice', 'Muthoni', 'alice@martin.co.ke', 'Finance', 'Accounts Clerk', 'permanent', '2022-02-01', 65000),
  ('E008', 'James', 'Mwangi', 'james@martin.co.ke', 'Warehouse', 'Warehouse Manager', 'permanent', '2019-05-01', 110000),
  ('E009', 'Lucy', 'Wambui', 'lucy@martin.co.ke', 'Sales', 'Sales Rep', 'permanent', '2023-04-01', 85000),
  ('E010', 'Peter', 'Kamau', 'peter@martin.co.ke', 'Sales', 'Sales Rep', 'probation', '2025-10-01', 70000),
  ('E011', 'Mary', 'Njeri', 'mary@martin.co.ke', 'HR', 'HR Officer', 'permanent', '2021-01-15', 95000),
  ('E012', 'John', 'Ochieng', 'john@martin.co.ke', 'Logistics', 'Fleet Supervisor', 'permanent', '2020-07-01', 88000),
  ('E013', 'Sarah', 'Chebet', 'sarah@martin.co.ke', 'Finance', 'Credit Controller', 'permanent', '2022-09-01', 92000),
  ('E014', 'Kevin', 'Mutua', 'kevin@martin.co.ke', 'Warehouse', 'Storekeeper', 'contract', '2024-01-01', 55000),
  ('E015', 'Ann', 'Wanjiru', 'ann@martin.co.ke', 'Sales', 'Customer Service', 'permanent', '2023-08-01', 72000),
  ('E016', 'David', 'Koech', 'david@martin.co.ke', 'Logistics', 'Driver', 'permanent', '2022-11-01', 48000),
  ('E017', 'Ruth', 'Akinyi', 'ruth@martin.co.ke', 'Warehouse', 'Picker', 'permanent', '2024-06-01', 42000),
  ('E018', 'Michael', 'Bett', 'michael@martin.co.ke', 'Sales', 'Key Account Manager', 'permanent', '2019-09-01', 150000),
  ('E019', 'Catherine', 'Nduta', 'catherine@martin.co.ke', 'Finance', 'Finance Manager', 'permanent', '2018-04-01', 220000),
  ('E020', 'George', 'Kimani', 'george@martin.co.ke', 'IT', 'Systems Admin', 'permanent', '2021-06-01', 130000)
) AS v(code, fname, lname, email, dept, title, etype, hire, salary)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_employees e WHERE e.company_id = c.id AND e.employee_code = v.code);

-- Price list
INSERT INTO erp_price_lists (company_id, code, name, currency_code, is_default)
SELECT c.id, 'RETAIL-2026', 'Retail Price List 2026', 'KES', TRUE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_price_lists pl WHERE pl.company_id = c.id AND pl.code = 'RETAIL-2026');

INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price)
SELECT pl.company_id, pl.id, i.id, v.price
FROM erp_price_lists pl
JOIN erp_companies c ON c.id = pl.company_id AND c.code = 'MARTIN'
JOIN erp_items i ON i.company_id = c.id
JOIN (VALUES
  ('TSK-500', 250), ('GNS-500', 320), ('JW-RED', 2600), ('COKE-500', 70), ('DSN-1L', 70)
) AS v(sku, price) ON i.item_code = v.sku
WHERE pl.code = 'RETAIL-2026'
  AND NOT EXISTS (
    SELECT 1 FROM erp_price_list_items x WHERE x.price_list_id = pl.id AND x.item_id = i.id
  );
