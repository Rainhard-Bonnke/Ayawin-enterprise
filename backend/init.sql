-- Martin Enterprise ERP schema and seed data

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT,
  phone TEXT,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_login TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  excise_rate NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT,
  category TEXT NOT NULL,
  brand TEXT,
  abv NUMERIC(5,2) NOT NULL DEFAULT 0,
  pack_size TEXT,
  litres_per_unit NUMERIC(10,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  retail_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  distributor_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  manager TEXT,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kra_pin TEXT NOT NULL UNIQUE,
  contact TEXT,
  email TEXT,
  address TEXT,
  location TEXT,
  type TEXT,
  segment TEXT,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_terms TEXT,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kra_pin TEXT NOT NULL UNIQUE,
  contact TEXT,
  email TEXT,
  phone TEXT,
  payment_terms TEXT,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  warehouse_id INT REFERENCES warehouses(id),
  movement_type TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL,
  reference_no TEXT,
  batch_no TEXT,
  expiry_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INT REFERENCES customers(id),
  sales_rep_id INT REFERENCES users(id),
  warehouse_id INT REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'Draft',
  order_date TIMESTAMP NOT NULL DEFAULT NOW(),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date TIMESTAMP,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id SERIAL PRIMARY KEY,
  sales_order_id INT REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  quantity NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  sales_order_id INT REFERENCES sales_orders(id),
  customer_id INT REFERENCES customers(id),
  invoice_date DATE NOT NULL,
  due_date DATE,
  etr_number TEXT,
  kra_pin TEXT NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  excise_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft'
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  description TEXT,
  quantity NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  excise_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES invoices(id),
  customer_id INT REFERENCES customers(id),
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  method TEXT NOT NULL,
  reference_no TEXT,
  status TEXT NOT NULL DEFAULT 'Posted'
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id INT REFERENCES suppliers(id),
  warehouse_id INT REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'Draft',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INT REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  quantity NUMERIC(14,2) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS grns (
  id SERIAL PRIMARY KEY,
  grn_number TEXT NOT NULL UNIQUE,
  purchase_order_id INT REFERENCES purchase_orders(id),
  supplier_id INT REFERENCES suppliers(id),
  received_date DATE NOT NULL,
  received_by TEXT,
  status TEXT NOT NULL DEFAULT 'Received'
);

CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  delivery_number TEXT NOT NULL UNIQUE,
  sales_order_id INT REFERENCES sales_orders(id),
  customer_id INT REFERENCES customers(id),
  driver_id INT REFERENCES users(id),
  vehicle_no TEXT,
  route TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  dispatch_date DATE,
  delivered_date DATE,
  pod_signature TEXT,
  pod_photo_url TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  user_id INT REFERENCES users(id),
  name TEXT NOT NULL,
  id_number TEXT,
  department TEXT,
  role TEXT,
  salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS payroll (
  id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id),
  payroll_month TEXT NOT NULL,
  gross_pay NUMERIC(14,2) NOT NULL,
  paye NUMERIC(14,2) NOT NULL DEFAULT 0,
  nhif NUMERIC(14,2) NOT NULL DEFAULT 0,
  nssf NUMERIC(14,2) NOT NULL DEFAULT 0,
  housing_levy NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft'
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  account_code TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  bank_name TEXT
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  reference_no TEXT,
  account_id INT REFERENCES accounts(id),
  description TEXT NOT NULL,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS taxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rate NUMERIC(12,4) NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'percentage',
  category TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- seed roles
INSERT INTO roles (name, description) VALUES
('Admin', 'Full access to all modules'),
('Manager', 'Operational oversight and approvals'),
('Sales Rep', 'Sales order and customer management'),
('Warehouse', 'Stock and fulfillment workflows'),
('Accountant', 'Finance, tax and reporting'),
('Driver', 'Delivery execution and proof of delivery')
ON CONFLICT (name) DO NOTHING;

-- seed categories
INSERT INTO categories (name, excise_rate) VALUES
('Beer', 121.85),
('Spirits', 356.28),
('Wine', 229.85),
('Soft Drinks', 10.68),
('Water', 0),
('Juice', 10.68)
ON CONFLICT (name) DO NOTHING;

-- seed users (6)
INSERT INTO users (username, full_name, email, role, status, phone, two_factor_enabled) VALUES
('admin', 'Admin User', 'admin@martin.co.ke', 'Admin', 'active', '+254 700 000 001', TRUE),
('manager', 'Grace Wanjiku', 'manager@martin.co.ke', 'Manager', 'active', '+254 700 000 002', TRUE),
('sales1', 'Brian Otieno', 'sales1@martin.co.ke', 'Sales Rep', 'active', '+254 700 000 003', FALSE),
('warehouse1', 'Faith Achieng', 'warehouse1@martin.co.ke', 'Warehouse', 'active', '+254 700 000 004', FALSE),
('account1', 'Daniel Kiprop', 'account1@martin.co.ke', 'Accountant', 'active', '+254 700 000 005', TRUE),
('driver1', 'Samuel Njoroge', 'driver1@martin.co.ke', 'Driver', 'active', '+254 700 000 006', FALSE)
ON CONFLICT (username) DO NOTHING;

-- seed warehouses
INSERT INTO warehouses (name, address, manager, phone) VALUES
('Nairobi Main', 'Industrial Area, Nairobi', 'James Mwangi', '+254 711 100 100'),
('Mombasa Branch', 'Changamwe, Mombasa', 'Aisha Mohamed', '+254 711 100 101'),
('Kisumu Branch', 'Kondele, Kisumu', 'Peter Otieno', '+254 711 100 102')
ON CONFLICT (name) DO NOTHING;

-- seed suppliers
INSERT INTO suppliers (name, kra_pin, contact, email, phone, payment_terms, credit_limit, balance) VALUES
('East African Breweries Ltd (EABL)', 'P051000001A', 'trade@eabl.com', 'trade@eabl.com', '+254 711 100 200', 'Net 30', 10000000, 3400000),
('Kenya Breweries Ltd (KBL)', 'P051000002B', 'supply@kbl.co.ke', 'supply@kbl.co.ke', '+254 711 100 201', 'Net 30', 8000000, 1200000),
('Keroche Breweries', 'P051000003C', 'sales@keroche.co.ke', 'sales@keroche.co.ke', '+254 711 100 202', 'Net 30', 5000000, 850000),
('Coca-Cola Beverages Africa', 'P051000004D', 'kenya@ccba.africa', 'kenya@ccba.africa', '+254 711 100 203', 'Net 30', 6000000, 2100000),
('Diageo Kenya', 'P051000005E', 'trade.ke@diageo.com', 'trade.ke@diageo.com', '+254 711 100 204', 'Net 45', 7000000, 0)
ON CONFLICT (kra_pin) DO NOTHING;

-- seed customers (10)
INSERT INTO customers (name, kra_pin, contact, email, address, location, type, segment, credit_limit, payment_terms, balance) VALUES
('Brew Bistro Westlands', 'P051234567A', '+254 712 345 001', 'orders@brewbistro.co.ke', 'Westlands, Nairobi', 'Westlands, Nairobi', 'Bar/Restaurant', 'Bar/Restaurant', 500000, 'Net 30', 142500),
('Naivas Supermarket Karen', 'P051234568B', '+254 712 345 002', 'procurement@naivas.co.ke', 'Karen, Nairobi', 'Karen, Nairobi', 'Supermarket', 'Supermarket', 2000000, 'Net 45', 890000),
('Quickmart Kilimani', 'P051234569C', '+254 712 345 003', 'buyer@quickmart.co.ke', 'Kilimani, Nairobi', 'Kilimani, Nairobi', 'Supermarket', 'Supermarket', 1500000, 'Net 30', 0),
('Mama Oliech Wholesalers', 'P051234570D', '+254 712 345 004', 'oliech@gmail.com', 'Kisumu', 'Kisumu', 'Wholesaler', 'Wholesaler', 800000, 'Net 15', 320000),
('Sippers Lounge Kilimani', 'P051234571E', '+254 712 345 005', 'sippers@gmail.com', 'Kilimani, Nairobi', 'Kilimani, Nairobi', 'Bar/Restaurant', 'Bar/Restaurant', 300000, 'Net 30', 285000),
('K1 Klub House', 'P051234572F', '+254 712 345 006', 'info@k1klub.co.ke', 'Parklands, Nairobi', 'Parklands, Nairobi', 'Bar/Restaurant', 'Bar/Restaurant', 600000, 'Net 30', 412000),
('Mombasa Liquor Distributors', 'P051234573G', '+254 712 345 007', 'ops@mld.co.ke', 'Mombasa', 'Mombasa', 'Distributor', 'Distributor', 3000000, 'Net 45', 1240000),
('Eldoret Wines & Spirits', 'P051234574H', '+254 712 345 008', 'eldoretws@gmail.com', 'Eldoret', 'Eldoret', 'Wholesaler', 'Wholesaler', 700000, 'Net 30', 0),
('Java House Yaya', 'P051234575I', '+254 712 345 009', 'supply@javahouse.com', 'Yaya Centre, Nairobi', 'Yaya Centre, Nairobi', 'Bar/Restaurant', 'Bar/Restaurant', 400000, 'Net 30', 78000),
('Carrefour Two Rivers', 'P051234576J', '+254 712 345 010', 'kenya.buying@carrefour.com', 'Two Rivers, Nairobi', 'Two Rivers, Nairobi', 'Supermarket', 'Supermarket', 2500000, 'Net 60', 1580000)
ON CONFLICT (kra_pin) DO NOTHING;

-- seed products (20)
INSERT INTO products (name, sku, barcode, category, brand, abv, pack_size, litres_per_unit, unit_price, cost_price, retail_price, wholesale_price, distributor_price, min_stock, status) VALUES
('Tusker Lager 500ml', 'TSK-500', '6161100012345', 'Beer', 'EABL', 4.2, '24x500ml', 0.500, 250, 180, 250, 220, 200, 200, 'active'),
('Tusker Cider 330ml', 'TSK-330', '6161100012346', 'Beer', 'EABL', 4.5, '24x330ml', 0.330, 220, 150, 220, 195, 175, 150, 'active'),
('Guinness Stout 500ml', 'GNS-500', '5000213000010', 'Beer', 'EABL', 7.5, '24x500ml', 0.500, 320, 220, 320, 290, 260, 100, 'active'),
('Whitecap Lager 500ml', 'WCP-500', '6161100012347', 'Beer', 'EABL', 4.5, '24x500ml', 0.500, 240, 175, 240, 215, 195, 200, 'active'),
('Balozi Lager 500ml', 'BLZ-500', '6161100012348', 'Beer', 'Keroche', 5.0, '24x500ml', 0.500, 230, 160, 230, 205, 185, 150, 'active'),
('Johnnie Walker Red 750ml', 'JW-RED', '5000267014206', 'Spirits', 'Diageo', 40.0, '12x750ml', 0.750, 2600, 1850, 2600, 2350, 2150, 50, 'active'),
('Johnnie Walker Black 750ml', 'JW-BLK', '5000267023748', 'Spirits', 'Diageo', 40.0, '12x750ml', 0.750, 4800, 3500, 4800, 4400, 4100, 30, 'active'),
('Smirnoff Vodka 750ml', 'SMV-750', '5410316430234', 'Spirits', 'Diageo', 37.5, '12x750ml', 0.750, 1750, 1200, 1750, 1580, 1430, 60, 'active'),
('Richot Brandy 750ml', 'RCH-750', '6001108055672', 'Spirits', 'Distell', 43.0, '12x750ml', 0.750, 1400, 950, 1400, 1260, 1130, 50, 'active'),
('Olmeca Tequila 750ml', 'OLM-750', '7501013005206', 'Spirits', 'Pernod Ricard', 38.0, '12x750ml', 0.750, 3100, 2200, 3100, 2820, 2580, 40, 'active'),
('Kingfisher Cape Wine 750ml', 'KCP-750', '6001108100123', 'Wine', 'KWV', 12.5, '6x750ml', 0.750, 1250, 850, 1250, 1120, 1000, 30, 'active'),
('Four Cousins Red 750ml', '4TH-750', '6009880123451', 'Wine', 'Van Loveren', 8.0, '6x750ml', 0.750, 1050, 720, 1050, 940, 840, 40, 'active'),
('Krest Bitter Lemon 300ml', 'KRS-300', '5449000131836', 'Soft Drinks', 'Coca-Cola', 0.0, '24x300ml', 0.300, 55, 35, 55, 48, 42, 300, 'active'),
('Alvaro Pear 500ml', 'ALV-500', '5449000131837', 'Soft Drinks', 'Coca-Cola', 0.0, '12x500ml', 0.500, 90, 60, 90, 80, 72, 200, 'active'),
('Coca-Cola 500ml', 'COKE-500', '5449000000996', 'Soft Drinks', 'Coca-Cola', 0.0, '24x500ml', 0.500, 70, 40, 70, 60, 52, 500, 'active'),
('Fanta Orange 500ml', 'FNT-500', '5449000050205', 'Soft Drinks', 'Coca-Cola', 0.0, '24x500ml', 0.500, 70, 40, 70, 60, 52, 400, 'active'),
('Dasani Water 1L', 'DSN-1L', '5449000054227', 'Water', 'Coca-Cola', 0.0, '12x1L', 1.000, 70, 45, 70, 60, 52, 250, 'active'),
('Keringet Mineral 500ml', 'KMI-500', '6161100099120', 'Water', 'Keringet', 0.0, '24x500ml', 0.500, 50, 25, 50, 42, 35, 400, 'active'),
('Delmonte Mango Juice 1L', 'DEL-1L', '0024000162018', 'Juice', 'Delmonte', 0.0, '12x1L', 1.000, 260, 180, 260, 230, 210, 80, 'active'),
('Picana Pineapple 1L', 'PIC-1L', '6161100200012', 'Juice', 'Kevian', 0.0, '12x1L', 1.000, 200, 130, 200, 175, 155, 100, 'active')
ON CONFLICT (sku) DO NOTHING;

-- seed opening stock movements (for realistic inventory dashboards)
INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_no, batch_no, expiry_date)
SELECT p.id, w.id, 'stock_in', x.qty, 'OPENING', x.batch_no, x.expiry_date
FROM (
  VALUES
    ('TSK-500', 'Nairobi Main', 1240::numeric, 'OPN-2026-TSK500', '2026-08-15'::date),
    ('TSK-330', 'Nairobi Main', 88::numeric, 'OPN-2026-TSK330', '2026-07-10'::date),
    ('GNS-500', 'Nairobi Main', 540::numeric, 'OPN-2026-GNS500', '2026-09-20'::date),
    ('WCP-500', 'Nairobi Main', 920::numeric, 'OPN-2026-WCP500', '2026-08-30'::date),
    ('BLZ-500', 'Mombasa Branch', 670::numeric, 'OPN-2026-BLZ500', '2026-10-05'::date),
    ('JW-RED', 'Nairobi Main', 320::numeric, 'OPN-2026-JWRED', '2030-12-31'::date),
    ('JW-BLK', 'Nairobi Main', 145::numeric, 'OPN-2026-JWBLK', '2030-12-31'::date),
    ('SMV-750', 'Nairobi Main', 410::numeric, 'OPN-2026-SMV750', '2030-12-31'::date),
    ('RCH-750', 'Nairobi Main', 260::numeric, 'OPN-2026-RCH750', '2030-12-31'::date),
    ('OLM-750', 'Nairobi Main', 95::numeric, 'OPN-2026-OLM750', '2030-12-31'::date),
    ('KCP-750', 'Nairobi Main', 180::numeric, 'OPN-2026-KCP750', '2027-06-30'::date),
    ('4TH-750', 'Nairobi Main', 240::numeric, 'OPN-2026-4TH750', '2027-04-15'::date),
    ('KRS-300', 'Nairobi Main', 2100::numeric, 'OPN-2026-KRS300', '2026-03-20'::date),
    ('ALV-500', 'Nairobi Main', 880::numeric, 'OPN-2026-ALV500', '2026-02-10'::date),
    ('COKE-500', 'Nairobi Main', 3200::numeric, 'OPN-2026-COKE500', '2026-05-12'::date),
    ('FNT-500', 'Kisumu Branch', 1850::numeric, 'OPN-2026-FNT500', '2026-04-22'::date),
    ('DSN-1L', 'Nairobi Main', 1500::numeric, 'OPN-2026-DSN1L', '2027-01-15'::date),
    ('KMI-500', 'Nairobi Main', 2400::numeric, 'OPN-2026-KMI500', '2027-03-01'::date),
    ('DEL-1L', 'Nairobi Main', 410::numeric, 'OPN-2026-DEL1L', '2026-06-18'::date),
    ('PIC-1L', 'Mombasa Branch', 60::numeric, 'OPN-2026-PIC1L', '2026-02-28'::date)
) AS x(sku, warehouse_name, qty, batch_no, expiry_date)
JOIN products p ON p.sku = x.sku
JOIN warehouses w ON w.name = x.warehouse_name
WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements sm
  WHERE sm.product_id = p.id AND sm.warehouse_id = w.id AND sm.reference_no = 'OPENING'
);

-- seed reference transactions
INSERT INTO sales_orders (order_number, customer_id, sales_rep_id, warehouse_id, status, order_date, total_amount, due_date, notes)
SELECT * FROM (VALUES
  ('SO-2026-0142', 1, 3, 1, 'Confirmed', '2026-05-20'::timestamp, 184500, '2026-06-19'::timestamp, 'Regular top-up'),
  ('SO-2026-0141', 6, 3, 1, 'Dispatched', '2026-05-20'::timestamp, 312000, '2026-06-19'::timestamp, 'VIP customer'),
  ('SO-2026-0140', 2, 2, 1, 'Delivered', '2026-05-19'::timestamp, 890000, '2026-06-18'::timestamp, 'Urgent replenishment'),
  ('SO-2026-0139', 7, 3, 2, 'Invoiced', '2026-05-19'::timestamp, 1420000, '2026-06-18'::timestamp, 'Distributor bulk order'),
  ('SO-2026-0138', 3, 2, 1, 'Invoiced', '2026-05-18'::timestamp, 425000, '2026-06-17'::timestamp, 'Weekly supply'),
  ('SO-2026-0137', 5, 3, 1, 'Draft', '2026-05-18'::timestamp, 98500, '2026-06-17'::timestamp, 'Pending approval'),
  ('SO-2026-0136', 9, 2, 1, 'Delivered', '2026-05-17'::timestamp, 156000, '2026-06-16'::timestamp, 'Cafe replenishment'),
  ('SO-2026-0135', 10, 2, 1, 'Invoiced', '2026-05-17'::timestamp, 1580000, '2026-06-16'::timestamp, 'Retail chain supply')
) AS t(order_number, customer_id, sales_rep_id, warehouse_id, status, order_date, total_amount, due_date, notes)
ON CONFLICT (order_number) DO NOTHING;

INSERT INTO invoices (invoice_number, sales_order_id, customer_id, invoice_date, due_date, etr_number, kra_pin, subtotal, excise_amount, vat_amount, total_amount, status)
SELECT * FROM (VALUES
  ('INV-2026-0531', 1, 7, '2026-05-19'::date, '2026-06-18'::date, '0010000123456789', 'P051234573G', 980000, 184500, 186320, 1350820, 'Sent'),
  ('INV-2026-0530', 2, 3, '2026-05-18'::date, '2026-06-17'::date, '0010000123456788', 'P051234569C', 320000, 52400, 59584, 431984, 'Paid'),
  ('INV-2026-0529', 3, 10, '2026-05-17'::date, '2026-06-16'::date, '0010000123456787', 'P051234576J', 1180000, 218400, 223744, 1622144, 'Sent'),
  ('INV-2026-0528', 4, 5, '2026-04-12'::date, '2026-05-12'::date, '0010000123456786', 'P051234571E', 215000, 38200, 40512, 293712, 'Overdue'),
  ('INV-2026-0527', 5, 6, '2026-04-08'::date, '2026-05-08'::date, '0010000123456785', 'P051234572F', 310000, 56400, 58624, 425024, 'Overdue'),
  ('INV-2026-0526', 6, 2, '2026-05-15'::date, '2026-06-14'::date, '0010000123456784', 'P051234568B', 660000, 118200, 124512, 902712, 'Paid')
) AS t(invoice_number, sales_order_id, customer_id, invoice_date, due_date, etr_number, kra_pin, subtotal, excise_amount, vat_amount, total_amount, status)
ON CONFLICT (invoice_number) DO NOTHING;

INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, status, order_date, expected_date, total_amount, credit_limit)
SELECT * FROM (VALUES
  ('PO-2026-0089', 1, 1, 'Received', '2026-05-19'::date, '2026-05-25'::date, 2840000, 10000000),
  ('PO-2026-0088', 5, 1, 'Sent', '2026-05-18'::date, '2026-05-26'::date, 1980000, 7000000),
  ('PO-2026-0087', 4, 2, 'Received', '2026-05-17'::date, '2026-05-23'::date, 1240000, 6000000),
  ('PO-2026-0086', 3, 1, 'Approved', '2026-05-15'::date, '2026-05-22'::date, 720000, 5000000),
  ('PO-2026-0085', 2, 3, 'Draft', '2026-05-14'::date, '2026-05-21'::date, 1820000, 8000000)
) AS t(po_number, supplier_id, warehouse_id, status, order_date, expected_date, total_amount, credit_limit)
ON CONFLICT (po_number) DO NOTHING;

-- Purchase order line items (use SKU joins so seeds work across environments)
INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost, line_total)
SELECT po.id, p.id, v.quantity, v.unit_cost, (v.quantity * v.unit_cost)
FROM (VALUES
  ('PO-2026-0088', 'JW-RED', 120, 1850),
  ('PO-2026-0088', 'SMV-750', 160, 1200),
  ('PO-2026-0086', 'BLZ-500', 600, 160),
  ('PO-2026-0085', 'TSK-500', 800, 180),
  ('PO-2026-0085', 'GNS-500', 420, 220)
) AS v(po_number, sku, quantity, unit_cost)
JOIN purchase_orders po ON po.po_number = v.po_number
JOIN products p ON p.sku = v.sku
LEFT JOIN purchase_order_items existing ON existing.purchase_order_id = po.id AND existing.product_id = p.id
WHERE existing.id IS NULL;

INSERT INTO taxes (name, rate, basis, category) VALUES
('VAT', 16.0000, 'percentage', 'all'),
('Beer Excise', 121.8500, 'per_litre', 'Beer'),
('Spirits Excise', 356.2800, 'per_litre', 'Spirits'),
('Wine Excise', 229.8500, 'per_litre', 'Wine'),
('Soft Drinks Excise', 10.6800, 'per_litre', 'Soft Drinks'),
('Juice Excise', 10.6800, 'per_litre', 'Juice')
ON CONFLICT (name) DO NOTHING;

INSERT INTO accounts (account_code, account_name, account_type, currency, opening_balance, bank_name) VALUES
('1100', 'Cash at Bank', 'Asset', 'KES', 8420000, 'KCB'),
('1200', 'Accounts Receivable', 'Asset', 'KES', 0, NULL),
('1300', 'Inventory', 'Asset', 'KES', 0, NULL),
('2100', 'Accounts Payable', 'Liability', 'KES', 0, NULL),
('2200', 'VAT Output', 'Liability', 'KES', 0, NULL),
('2300', 'Excise Duty Payable', 'Liability', 'KES', 0, NULL),
('4000', 'Sales Revenue', 'Income', 'KES', 0, NULL)
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO employees (employee_code, user_id, name, id_number, department, role, salary, status) VALUES
('E001', 1, 'Admin User', 'ID001', 'Executive', 'CEO', 450000, 'Active'),
('E002', 2, 'Grace Wanjiku', 'ID002', 'Sales', 'Sales Manager', 180000, 'Active'),
('E003', 3, 'Brian Otieno', 'ID003', 'Sales', 'Senior Sales Rep', 95000, 'Active'),
('E004', 4, 'Faith Achieng', 'ID004', 'Warehouse', 'Warehouse Supervisor', 78000, 'Active'),
('E005', 5, 'Daniel Kiprop', 'ID005', 'Finance', 'Accountant', 120000, 'Active'),
('E006', 6, 'Samuel Njoroge', 'ID006', 'Logistics', 'Driver', 45000, 'Active')
ON CONFLICT (employee_code) DO NOTHING;

INSERT INTO payroll (employee_id, payroll_month, gross_pay, paye, nhif, nssf, housing_levy, net_pay, status) VALUES
(1, 'May 2026', 450000, 123000, 12375, 4320, 6750, 303555, 'Posted'),
(2, 'May 2026', 180000, 42300, 4950, 4320, 2700, 125730, 'Posted'),
(3, 'May 2026', 95000, 14550, 2613, 4320, 1425, 62092, 'Posted'),
(4, 'May 2026', 78000, 10440, 2145, 4320, 1170, 59925, 'Posted'),
(5, 'May 2026', 120000, 18000, 3300, 4320, 1800, 82580, 'Posted'),
(6, 'May 2026', 45000, 3150, 1238, 2700, 675, 37237, 'Posted');

INSERT INTO journal_entries (entry_date, reference_no, account_id, description, debit, credit) VALUES
('2026-05-20', 'PAY-001', 1, 'Payment received - Quickmart', 431984, 0),
('2026-05-20', 'PAY-001', 2, 'Payment received - Quickmart', 0, 431984),
('2026-05-19', 'INV-2026-0531', 2, 'Invoice raised - Mombasa Liquor Distributors', 1350820, 0),
('2026-05-19', 'INV-2026-0531', 7, 'Sales revenue', 0, 980000),
('2026-05-19', 'INV-2026-0531', 6, 'Excise duty payable', 0, 184500),
('2026-05-19', 'INV-2026-0531', 5, 'VAT output', 0, 186320);

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES
(1, 'Login', 'session', 'U1', '{"ip":"127.0.0.1","channel":"web"}'),
(2, 'Created sales order', 'sales_orders', 'SO-2026-0142', '{"status":"Confirmed"}'),
(5, 'Posted payroll', 'payroll', 'May 2026', '{"runs":6}');
