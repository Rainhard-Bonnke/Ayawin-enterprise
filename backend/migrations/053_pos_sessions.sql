ALTER TABLE erp_refresh_tokens
  ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'user'
  CHECK (session_type IN ('user', 'pos'));

INSERT INTO erp_roles (company_id, name, description, is_system)
SELECT c.id, 'POS Operator', 'Point-of-sale cashier access', TRUE
FROM erp_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM erp_roles r WHERE r.company_id = c.id AND r.name = 'POS Operator'
);

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
JOIN erp_permissions p ON p.code IN ('sales.view', 'sales.create', 'master_data.view')
WHERE r.name = 'POS Operator'
  AND NOT EXISTS (
    SELECT 1 FROM erp_role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

DELETE FROM erp_role_permissions rp
USING erp_roles r, erp_permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id
  AND r.name = 'POS Operator'
  AND p.code NOT IN ('sales.view', 'sales.create', 'master_data.view');
