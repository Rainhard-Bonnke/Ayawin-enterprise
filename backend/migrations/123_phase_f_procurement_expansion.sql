CREATE TABLE IF NOT EXISTS erp_supplier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  supplier_id UUID NOT NULL REFERENCES erp_vendors (id),
  document_type TEXT NOT NULL,
  document_name TEXT,
  file_url TEXT,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'archived')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_supplier_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  supplier_id UUID NOT NULL REFERENCES erp_vendors (id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  on_time_delivery_pct NUMERIC(9, 2) NOT NULL DEFAULT 0,
  short_receipt_pct NUMERIC(9, 2) NOT NULL DEFAULT 0,
  rejected_receipt_pct NUMERIC(9, 2) NOT NULL DEFAULT 0,
  price_variance_pct NUMERIC(9, 2) NOT NULL DEFAULT 0,
  invoice_accuracy_pct NUMERIC(9, 2) NOT NULL DEFAULT 0,
  total_score NUMERIC(9, 2) NOT NULL DEFAULT 0,
  review_notes TEXT,
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_supplier_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  supplier_id UUID NOT NULL REFERENCES erp_vendors (id),
  reason TEXT NOT NULL,
  blacklisted_by UUID,
  blacklisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS erp_procurement_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  policy_name TEXT NOT NULL,
  approval_threshold NUMERIC(18, 4) NOT NULL DEFAULT 0,
  quote_count_min INTEGER NOT NULL DEFAULT 3,
  quote_threshold_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  preferred_supplier_only BOOLEAN NOT NULL DEFAULT FALSE,
  require_maker_checker BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, policy_name)
);

CREATE TABLE IF NOT EXISTS erp_tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  tender_no TEXT NOT NULL,
  title TEXT NOT NULL,
  tender_type TEXT NOT NULL DEFAULT 'open'
    CHECK (tender_type IN ('open', 'restricted', 'framework')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'open', 'evaluating', 'awarded', 'cancelled')),
  published_at TIMESTAMPTZ,
  submission_deadline TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, tender_no)
);

CREATE TABLE IF NOT EXISTS erp_tender_bidders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  tender_id UUID NOT NULL REFERENCES erp_tenders (id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  registration_status TEXT NOT NULL DEFAULT 'registered'
    CHECK (registration_status IN ('registered', 'submitted', 'qualified', 'disqualified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tender_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS erp_tender_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  tender_id UUID NOT NULL REFERENCES erp_tenders (id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES erp_vendors (id),
  evaluator_name TEXT NOT NULL,
  score NUMERIC(9, 2) NOT NULL DEFAULT 0,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tender_id, vendor_id, evaluator_name)
);

CREATE TABLE IF NOT EXISTS erp_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  supplier_id UUID NOT NULL REFERENCES erp_vendors (id),
  contract_no TEXT NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'supplier'
    CHECK (contract_type IN ('supplier', 'service', 'framework')),
  value_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  owner_user_id UUID,
  renewal_terms TEXT,
  service_levels TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, contract_no)
);

CREATE TABLE IF NOT EXISTS erp_contract_call_offs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  contract_id UUID NOT NULL REFERENCES erp_contracts (id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES erp_purchase_orders (id),
  calloff_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, purchase_order_id)
);

CREATE TABLE IF NOT EXISTS erp_cost_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  allocation_type TEXT NOT NULL
    CHECK (allocation_type IN ('supplier_bill', 'purchase_order', 'goods_receipt', 'project')),
  source_id UUID NOT NULL,
  department TEXT,
  cost_centre TEXT,
  project_code TEXT,
  branch_id UUID REFERENCES erp_branches (id),
  allocation_pct NUMERIC(9, 2) NOT NULL DEFAULT 0,
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
