-- Module 2: Master Data Management

-- Payment terms
CREATE TABLE IF NOT EXISTS erp_payment_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  due_days INT NOT NULL DEFAULT 0,
  discount_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  discount_days INT NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

-- Tax groups & rates
CREATE TABLE IF NOT EXISTS erp_tax_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(12, 6) NOT NULL DEFAULT 0,
  tax_type TEXT NOT NULL DEFAULT 'vat'
    CHECK (tax_type IN ('vat', 'withholding', 'excise', 'other')),
  basis TEXT NOT NULL DEFAULT 'percentage'
    CHECK (basis IN ('percentage', 'fixed', 'per_unit')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_tax_group_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  tax_group_id UUID NOT NULL REFERENCES erp_tax_groups (id) ON DELETE CASCADE,
  tax_rate_id UUID NOT NULL REFERENCES erp_tax_rates (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tax_group_id, tax_rate_id)
);

-- Chart of accounts (hierarchical)
CREATE TABLE IF NOT EXISTS erp_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  parent_id UUID REFERENCES erp_chart_of_accounts (id),
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  level INT NOT NULL DEFAULT 1,
  is_postable BOOLEAN NOT NULL DEFAULT TRUE,
  currency_code CHAR(3) REFERENCES erp_currencies (code),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, account_code)
);

CREATE INDEX IF NOT EXISTS erp_coa_company_parent_idx ON erp_chart_of_accounts (company_id, parent_id);

-- Units of measure
CREATE TABLE IF NOT EXISTS erp_uom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

-- Item categories
CREATE TABLE IF NOT EXISTS erp_item_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  parent_id UUID REFERENCES erp_item_categories (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

-- Items / products
CREATE TABLE IF NOT EXISTS erp_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  category_id UUID REFERENCES erp_item_categories (id),
  tax_group_id UUID REFERENCES erp_tax_groups (id),
  uom_id UUID REFERENCES erp_uom (id),
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  barcode TEXT,
  cost_method TEXT NOT NULL DEFAULT 'weighted_average'
    CHECK (cost_method IN ('fifo', 'lifo', 'weighted_average', 'standard')),
  standard_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  is_purchasable BOOLEAN NOT NULL DEFAULT TRUE,
  is_saleable BOOLEAN NOT NULL DEFAULT TRUE,
  is_stock_item BOOLEAN NOT NULL DEFAULT TRUE,
  reorder_point NUMERIC(18, 4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, item_code)
);

CREATE INDEX IF NOT EXISTS erp_items_company_category_idx ON erp_items (company_id, category_id);

-- Customers
CREATE TABLE IF NOT EXISTS erp_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  payment_terms_id UUID REFERENCES erp_payment_terms (id),
  currency_code CHAR(3) REFERENCES erp_currencies (code),
  customer_code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_id TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'KE',
  credit_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
  customer_type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, customer_code)
);

CREATE INDEX IF NOT EXISTS erp_customers_company_name_idx ON erp_customers (company_id, name);

-- Vendors / suppliers
CREATE TABLE IF NOT EXISTS erp_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  payment_terms_id UUID REFERENCES erp_payment_terms (id),
  currency_code CHAR(3) REFERENCES erp_currencies (code),
  vendor_code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_id TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  city TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'KE',
  bank_name TEXT,
  bank_account_no TEXT,
  bank_branch TEXT,
  credit_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, vendor_code)
);

-- Employees
CREATE TABLE IF NOT EXISTS erp_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  branch_id UUID REFERENCES erp_branches (id),
  user_id UUID REFERENCES erp_users (id),
  manager_id UUID REFERENCES erp_employees (id),
  employee_code TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  department TEXT,
  job_title TEXT,
  employment_type TEXT NOT NULL DEFAULT 'permanent'
    CHECK (employment_type IN ('permanent', 'contract', 'probation', 'intern')),
  hire_date DATE,
  bank_name TEXT,
  bank_account_no TEXT,
  tax_pin TEXT,
  basic_salary NUMERIC(18, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, employee_code)
);

CREATE INDEX IF NOT EXISTS erp_employees_company_dept_idx ON erp_employees (company_id, department);

-- Warehouses & bins
CREATE TABLE IF NOT EXISTS erp_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  branch_id UUID REFERENCES erp_branches (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address_line1 TEXT,
  city TEXT,
  manager_name TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_warehouse_bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT,
  aisle TEXT,
  rack TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (warehouse_id, code)
);

-- Price lists
CREATE TABLE IF NOT EXISTS erp_price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  currency_code CHAR(3) REFERENCES erp_currencies (code),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  price_list_id UUID NOT NULL REFERENCES erp_price_lists (id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  min_qty NUMERIC(18, 4) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (price_list_id, item_id, min_qty)
);

-- updated_at triggers
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_payment_terms', 'erp_tax_groups', 'erp_tax_rates', 'erp_tax_group_rates',
    'erp_chart_of_accounts', 'erp_uom', 'erp_item_categories', 'erp_items',
    'erp_customers', 'erp_vendors', 'erp_employees', 'erp_warehouses',
    'erp_warehouse_bins', 'erp_price_lists', 'erp_price_list_items'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
