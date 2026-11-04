ALTER TABLE erp_permissions DROP CONSTRAINT IF EXISTS erp_permissions_module_action_chk;
ALTER TABLE erp_permissions ADD CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
  'view', 'create', 'edit', 'delete', 'approve', 'export', 'price_override', 'discount_approve', 'credit_override',
  'order_create', 'order_approve', 'delivery_post', 'invoice_create', 'invoice_post', 'receipt_create',
  'receipt_approve', 'credit_note_create', 'credit_note_approve'
));

INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('sales', 'price_override', 'sales.price_override', 'Override a customer price list price or item floor'),
  ('sales', 'discount_approve', 'sales.discount_approve', 'Approve discounts above company policy')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE erp_customers ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES erp_price_lists(id);
ALTER TABLE erp_items ADD COLUMN IF NOT EXISTS minimum_sale_price NUMERIC(18,4) CHECK (minimum_sale_price IS NULL OR minimum_sale_price >= 0);
ALTER TABLE erp_items ADD COLUMN IF NOT EXISTS is_free_issue BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS discount_approval_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (discount_approval_status IN ('not_required','pending','approved'));
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS discount_approved_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS discount_approved_at TIMESTAMPTZ;
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS discount_approval_reason TEXT;
ALTER TABLE erp_sales_order_lines ADD COLUMN IF NOT EXISTS list_unit_price NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE erp_sales_order_lines ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100);
ALTER TABLE erp_sales_order_lines ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE erp_sales_order_lines ADD COLUMN IF NOT EXISTS free_issue_reason_code TEXT;
ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE erp_customer_invoice_lines ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100);
ALTER TABLE erp_customer_invoice_lines ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

INSERT INTO erp_system_settings (company_id, category, setting_key, setting_value, description)
SELECT id, 'sales', 'maximum_discount_percent', '10'::jsonb,
       'Maximum sales line discount percentage before independent approval is required'
FROM erp_companies
ON CONFLICT (company_id, category, setting_key) DO NOTHING;

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT role.company_id, role.id, permission.id
FROM erp_roles role
CROSS JOIN erp_permissions permission
WHERE role.name IN ('System Administrator','Admin')
  AND permission.code IN ('sales.price_override','sales.discount_approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;
