INSERT INTO erp_permissions (module, action, code, description)
VALUES ('sales', 'credit_override', 'sales.credit_override', 'Approve a time-limited credit override for one sales order')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT role.company_id, role.id, permission.id
FROM erp_roles role CROSS JOIN erp_permissions permission
WHERE role.name IN ('System Administrator','Admin') AND permission.code='sales.credit_override'
ON CONFLICT (role_id, permission_id) DO NOTHING;

ALTER TABLE erp_customers ADD COLUMN IF NOT EXISTS credit_hold BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS credit_override_approved_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS credit_override_reason TEXT;
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS credit_override_approved_at TIMESTAMPTZ;
ALTER TABLE erp_sales_orders ADD COLUMN IF NOT EXISTS credit_override_expires_at TIMESTAMPTZ;
ALTER TABLE erp_customer_receipts ADD COLUMN IF NOT EXISTS unapplied_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0);

INSERT INTO erp_system_settings (company_id, category, setting_key, setting_value, description)
SELECT id, 'sales', 'overdue_block_days', '30'::jsonb,
       'Days past invoice due date before sales confirmation is blocked for overdue credit'
FROM erp_companies
ON CONFLICT (company_id, category, setting_key) DO NOTHING;
