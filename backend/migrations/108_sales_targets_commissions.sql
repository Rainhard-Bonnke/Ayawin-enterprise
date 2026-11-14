ALTER TABLE erp_sales_orders
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES erp_users (id);

ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES erp_users (id);

UPDATE erp_sales_orders
SET sales_rep_id = created_by
WHERE sales_rep_id IS NULL AND created_by IS NOT NULL;

UPDATE erp_customer_invoices invoice
SET sales_rep_id = COALESCE(sales_order.sales_rep_id, invoice.created_by)
FROM erp_sales_orders sales_order
WHERE invoice.sales_order_id = sales_order.id
  AND invoice.sales_rep_id IS NULL;

UPDATE erp_customer_invoices
SET sales_rep_id = created_by
WHERE sales_rep_id IS NULL AND created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS erp_customer_invoices_sales_rep_date_idx
  ON erp_customer_invoices (company_id, sales_rep_id, invoice_date)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_sales_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  sales_rep_id UUID NOT NULL REFERENCES erp_users (id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_amount NUMERIC(18, 2) NOT NULL CHECK (target_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id),
  updated_by UUID REFERENCES erp_users (id),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (period_end >= period_start),
  UNIQUE (company_id, sales_rep_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS erp_sales_commission_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate_percent NUMERIC(7, 4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id),
  updated_by UUID REFERENCES erp_users (id),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (company_id, code, effective_from)
);

CREATE INDEX IF NOT EXISTS erp_sales_commission_plans_effective_idx
  ON erp_sales_commission_plans (company_id, effective_from, effective_to)
  WHERE is_deleted = FALSE;

ALTER TABLE erp_permissions DROP CONSTRAINT IF EXISTS erp_permissions_module_action_chk;
ALTER TABLE erp_permissions ADD CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
  'view','create','edit','delete','approve','export','price_override','discount_approve','credit_override',
  'order_create','order_approve','delivery_post','invoice_create','invoice_post','receipt_create','receipt_approve',
  'credit_note_create','credit_note_approve','prepare','production_certify','retry','target_manage'
));

INSERT INTO erp_permissions(module, action, code, description)
VALUES ('sales', 'target_manage', 'sales.target.manage', 'Manage sales targets and commission plans')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_role_permissions(company_id, role_id, permission_id)
SELECT role.company_id, role.id, permission.id
FROM erp_roles role
CROSS JOIN erp_permissions permission
WHERE role.name IN ('Admin', 'System Administrator', 'Manager', 'Operations Manager')
  AND permission.code = 'sales.target.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;