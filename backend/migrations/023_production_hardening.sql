-- Production hardening: MD PO approval, PII encryption columns, permissions

ALTER TABLE erp_purchase_orders DROP CONSTRAINT IF EXISTS erp_purchase_orders_status_check;
ALTER TABLE erp_purchase_orders ADD CONSTRAINT erp_purchase_orders_status_check
  CHECK (status IN (
    'draft', 'submitted', 'pending_md_approval', 'approved', 'sent',
    'partial', 'received', 'closed', 'cancelled'
  ));

ALTER TABLE erp_purchase_orders
  ADD COLUMN IF NOT EXISTS requires_md_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS md_approved_by UUID REFERENCES erp_users (id),
  ADD COLUMN IF NOT EXISTS md_approved_at TIMESTAMPTZ;

ALTER TABLE erp_customers
  ADD COLUMN IF NOT EXISTS tax_id_enc TEXT,
  ADD COLUMN IF NOT EXISTS phone_enc TEXT;

ALTER TABLE erp_vendors
  ADD COLUMN IF NOT EXISTS tax_id_enc TEXT,
  ADD COLUMN IF NOT EXISTS phone_enc TEXT;

INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('procurement', 'approve', 'procurement.md_approve', 'Approve purchase orders above MD threshold')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_roles (company_id, name, description, is_system)
SELECT c.id, 'Managing Director', 'Executive approval for high-value POs', TRUE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_roles r WHERE r.company_id = c.id AND r.name = 'Managing Director');

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
JOIN erp_companies c ON c.id = r.company_id AND c.code = 'MARTIN'
JOIN erp_permissions p ON p.code IN (
  'foundation.view', 'procurement.view', 'procurement.approve', 'procurement.md_approve',
  'finance.view', 'finance.approve', 'reports.view'
)
WHERE r.name = 'Managing Director'
  AND NOT EXISTS (
    SELECT 1 FROM erp_role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
