-- Sales Representative role (no HR/payroll access) + demo sales user for RBAC tests

INSERT INTO erp_roles (company_id, name, description, is_system)
SELECT c.id, 'Sales Representative', 'Field sales — orders and customers only', TRUE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_roles r WHERE r.company_id = c.id AND r.name = 'Sales Representative'
  );

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
JOIN erp_companies c ON c.id = r.company_id AND c.code = 'MARTIN'
JOIN erp_permissions p ON p.code IN (
  'sales.view', 'sales.create', 'sales.edit',
  'master_data.view',
  'reports.view',
  'foundation.view'
)
WHERE r.name = 'Sales Representative'
  AND NOT EXISTS (
    SELECT 1 FROM erp_role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO erp_users (
  company_id, default_branch_id, role_id, username, email, full_name, phone, status, locale
)
SELECT
  c.id,
  b.id,
  r.id,
  'salesrep',
  'salesrep@martin.co.ke',
  'Demo Sales Rep',
  '+254700000099',
  'active',
  'en'
FROM erp_companies c
JOIN erp_branches b ON b.company_id = c.id AND b.code = 'HQ'
JOIN erp_roles r ON r.company_id = c.id AND r.name = 'Sales Representative'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_users u WHERE u.company_id = c.id AND u.email = 'salesrep@martin.co.ke'
  );
