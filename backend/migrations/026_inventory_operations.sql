-- Controlled internal stock requests, issues, returns, and adjustment journals.
ALTER TABLE erp_stock_adjustments
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE erp_stock_adjustment_lines
  ADD COLUMN IF NOT EXISTS system_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS physical_quantity NUMERIC(18,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS erp_material_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  branch_id UUID REFERENCES erp_branches(id),
  request_no TEXT NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses(id),
  requesting_department TEXT NOT NULL DEFAULT '',
  requested_by UUID NOT NULL REFERENCES erp_users(id),
  required_date DATE,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','partially_issued','issued','rejected','cancelled')),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES erp_users(id),
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE(company_id, request_no)
);

CREATE TABLE IF NOT EXISTS erp_material_requisition_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  requisition_id UUID NOT NULL REFERENCES erp_material_requisitions(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item_id UUID NOT NULL REFERENCES erp_items(id),
  requested_quantity NUMERIC(18,4) NOT NULL CHECK (requested_quantity > 0),
  approved_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (approved_quantity >= 0),
  issued_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (issued_quantity >= 0),
  uom_id UUID REFERENCES erp_uom(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE(requisition_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_material_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  requisition_id UUID NOT NULL REFERENCES erp_material_requisitions(id),
  issue_no TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recipient_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE(company_id, issue_no)
);

CREATE TABLE IF NOT EXISTS erp_material_issue_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  issue_id UUID NOT NULL REFERENCES erp_material_issues(id) ON DELETE CASCADE,
  requisition_line_id UUID NOT NULL REFERENCES erp_material_requisition_lines(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_material_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  issue_id UUID NOT NULL REFERENCES erp_material_issues(id),
  return_no TEXT NOT NULL,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE(company_id, return_no)
);

CREATE TABLE IF NOT EXISTS erp_material_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  return_id UUID NOT NULL REFERENCES erp_material_returns(id) ON DELETE CASCADE,
  issue_line_id UUID NOT NULL REFERENCES erp_material_issue_lines(id),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL CHECK (condition IN ('good','damaged')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_material_requisitions_company_status_idx
  ON erp_material_requisitions(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS erp_material_issues_company_date_idx
  ON erp_material_issues(company_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS erp_material_returns_company_date_idx
  ON erp_material_returns(company_id, return_date DESC);

DROP TRIGGER IF EXISTS trg_erp_material_requisitions_updated_at ON erp_material_requisitions;
CREATE TRIGGER trg_erp_material_requisitions_updated_at BEFORE UPDATE ON erp_material_requisitions
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();
