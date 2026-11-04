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

-- No demo users or transactional records are inserted by schema bootstrap.
