ALTER TABLE erp_vendors
  ADD COLUMN IF NOT EXISTS tax_residency TEXT
    CHECK (tax_residency IS NULL OR tax_residency IN ('resident', 'non_resident'));

ALTER TABLE erp_supplier_bill_lines
  ADD COLUMN IF NOT EXISTS withholding_category_id UUID;

CREATE TABLE IF NOT EXISTS erp_withholding_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  residency TEXT NOT NULL CHECK (residency IN ('resident', 'non_resident')),
  rate NUMERIC(8, 5) NOT NULL CHECK (rate > 0 AND rate <= 100),
  taxable_basis TEXT NOT NULL CHECK (taxable_basis IN ('net_before_vat', 'gross_including_vat')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  remittance_working_days INTEGER NOT NULL CHECK (remittance_working_days BETWEEN 1 AND 30),
  liability_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'disabled')),
  created_by UUID NOT NULL REFERENCES erp_users (id),
  approved_by UUID REFERENCES erp_users (id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (company_id, code, effective_from)
);

ALTER TABLE erp_supplier_bill_lines
  ADD CONSTRAINT erp_supplier_bill_lines_wht_category_fk
  FOREIGN KEY (withholding_category_id) REFERENCES erp_withholding_categories (id);

CREATE INDEX IF NOT EXISTS erp_wht_categories_company_status_date_idx
  ON erp_withholding_categories (company_id, status, effective_from)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_withholding_remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  remittance_no TEXT NOT NULL,
  remittance_date DATE NOT NULL,
  bank_account_id UUID NOT NULL REFERENCES erp_chart_of_accounts (id),
  payment_reference TEXT NOT NULL,
  journal_id UUID REFERENCES erp_journals (id),
  total_amount NUMERIC(18, 2) NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  created_by UUID NOT NULL REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, remittance_no),
  UNIQUE (journal_id)
);

CREATE TABLE IF NOT EXISTS erp_withholding_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  bill_id UUID NOT NULL REFERENCES erp_supplier_bills (id),
  bill_line_id UUID NOT NULL REFERENCES erp_supplier_bill_lines (id),
  payment_id UUID NOT NULL REFERENCES erp_supplier_payments (id),
  category_id UUID NOT NULL REFERENCES erp_withholding_categories (id),
  taxable_base NUMERIC(18, 2) NOT NULL CHECK (taxable_base > 0),
  rate NUMERIC(8, 5) NOT NULL CHECK (rate > 0 AND rate <= 100),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'remitted')),
  remittance_id UUID REFERENCES erp_withholding_remittances (id),
  certificate_no TEXT,
  remitted_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES erp_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, bill_line_id, category_id)
);

CREATE INDEX IF NOT EXISTS erp_wht_obligations_company_status_due_idx
  ON erp_withholding_obligations (company_id, status, due_date);

INSERT INTO erp_chart_of_accounts (
  company_id, parent_id, account_code, account_name, account_type,
  level, is_postable, currency_code, is_active
)
SELECT company.id, parent.id, '2190', 'Withholding Tax Payable', 'liability',
       parent.level + 1, TRUE, company.base_currency_code, TRUE
FROM erp_companies company
JOIN erp_chart_of_accounts parent
  ON parent.company_id = company.id
 AND parent.account_code = '2000'
 AND parent.is_deleted = FALSE
WHERE company.is_deleted = FALSE
ON CONFLICT (company_id, account_code) DO NOTHING;

UPDATE erp_withholding_categories category
SET liability_account_id = account.id,
    updated_at = NOW()
FROM erp_chart_of_accounts account
WHERE account.company_id = category.company_id
  AND account.account_code = '2190'
  AND account.account_type = 'liability'
  AND category.liability_account_id IS NULL;