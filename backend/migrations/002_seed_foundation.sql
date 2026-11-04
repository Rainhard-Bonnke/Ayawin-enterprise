-- Module 1 seed: currencies, languages, permissions, demo company, admin user

INSERT INTO erp_currencies (code, name, symbol, decimal_places) VALUES
  ('KES', 'Kenyan Shilling', 'KSh', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2),
  ('UGX', 'Ugandan Shilling', 'USh', 0),
  ('TZS', 'Tanzanian Shilling', 'TSh', 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_languages (code, name, native_name) VALUES
  ('en', 'English', 'English'),
  ('sw', 'Swahili', 'Kiswahili'),
  ('fr', 'French', 'Français')
ON CONFLICT (code) DO NOTHING;

-- Core permissions across ERP modules
INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('foundation', 'view', 'foundation.view', 'View company and system settings'),
  ('foundation', 'edit', 'foundation.edit', 'Edit company and system settings'),
  ('foundation', 'export', 'foundation.export', 'Export foundation data'),
  ('users', 'view', 'users.view', 'View users'),
  ('users', 'create', 'users.create', 'Create users'),
  ('users', 'edit', 'users.edit', 'Edit users'),
  ('users', 'delete', 'users.delete', 'Deactivate users'),
  ('roles', 'view', 'roles.view', 'View roles'),
  ('roles', 'create', 'roles.create', 'Create roles'),
  ('roles', 'edit', 'roles.edit', 'Edit roles'),
  ('roles', 'delete', 'roles.delete', 'Delete roles'),
  ('audit', 'view', 'audit.view', 'View audit trail'),
  ('audit', 'export', 'audit.export', 'Export audit trail'),
  ('master_data', 'view', 'master_data.view', 'View master data'),
  ('master_data', 'create', 'master_data.create', 'Create master data'),
  ('master_data', 'edit', 'master_data.edit', 'Edit master data'),
  ('master_data', 'delete', 'master_data.delete', 'Delete master data'),
  ('finance', 'view', 'finance.view', 'View financial records'),
  ('finance', 'create', 'finance.create', 'Create financial transactions'),
  ('finance', 'edit', 'finance.edit', 'Edit financial transactions'),
  ('finance', 'delete', 'finance.delete', 'Delete financial transactions'),
  ('finance', 'approve', 'finance.approve', 'Approve financial transactions'),
  ('finance', 'export', 'finance.export', 'Export financial reports'),
  ('procurement', 'view', 'procurement.view', 'View procurement'),
  ('procurement', 'create', 'procurement.create', 'Create procurement documents'),
  ('procurement', 'edit', 'procurement.edit', 'Edit procurement documents'),
  ('procurement', 'approve', 'procurement.approve', 'Approve procurement documents'),
  ('sales', 'view', 'sales.view', 'View sales'),
  ('sales', 'create', 'sales.create', 'Create sales documents'),
  ('sales', 'edit', 'sales.edit', 'Edit sales documents'),
  ('sales', 'approve', 'sales.approve', 'Approve sales documents'),
  ('hr', 'view', 'hr.view', 'View HR data'),
  ('hr', 'create', 'hr.create', 'Create HR records'),
  ('hr', 'edit', 'hr.edit', 'Edit HR records'),
  ('hr', 'approve', 'hr.approve', 'Approve HR workflows'),
  ('reports', 'view', 'reports.view', 'View reports'),
  ('reports', 'export', 'reports.export', 'Export reports')
ON CONFLICT (code) DO NOTHING;

-- Default tenant scaffold; administrator credentials are configured via environment.
INSERT INTO erp_companies (
  code, name, legal_name, tax_registration_no, base_currency_code,
  fiscal_year_start_month, default_language_code, timezone
)
SELECT
  'MARTIN', 'Martin Beverages Ltd', 'Martin Beverages Limited',
  'P051000099Z', 'KES', 1, 'en', 'Africa/Nairobi'
WHERE NOT EXISTS (SELECT 1 FROM erp_companies WHERE code = 'MARTIN');

-- Branches
INSERT INTO erp_branches (company_id, code, name, address_line1, city, is_head_office)
SELECT c.id, v.code, v.name, v.address, v.city, v.is_hq
FROM erp_companies c
CROSS JOIN (VALUES
  ('HQ', 'Nairobi Head Office', 'Industrial Area, Nairobi', 'Nairobi', TRUE),
  ('MBA', 'Mombasa Branch', 'Changamwe, Mombasa', 'Mombasa', FALSE),
  ('KSM', 'Kisumu Branch', 'Kondele, Kisumu', 'Kisumu', FALSE)
) AS v(code, name, address, city, is_hq)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_branches b WHERE b.company_id = c.id AND b.code = v.code
  );

-- System Administrator role with all permissions
INSERT INTO erp_roles (company_id, name, description, is_system)
SELECT c.id, 'System Administrator', 'Full ERP access', TRUE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_roles r WHERE r.company_id = c.id AND r.name = 'System Administrator');

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
JOIN erp_companies c ON c.id = r.company_id AND c.code = 'MARTIN'
CROSS JOIN erp_permissions p
WHERE r.name = 'System Administrator'
  AND NOT EXISTS (
    SELECT 1 FROM erp_role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Manager role (subset)
INSERT INTO erp_roles (company_id, name, description, is_system)
SELECT c.id, 'Operations Manager', 'Operational oversight', TRUE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_roles r WHERE r.company_id = c.id AND r.name = 'Operations Manager');

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
JOIN erp_companies c ON c.id = r.company_id AND c.code = 'MARTIN'
JOIN erp_permissions p ON p.code LIKE '%.view' OR p.code LIKE '%.approve' OR p.code LIKE 'reports.%'
WHERE r.name = 'Operations Manager'
  AND NOT EXISTS (
    SELECT 1 FROM erp_role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- System settings
INSERT INTO erp_system_settings (company_id, category, setting_key, setting_value, description)
SELECT c.id, v.category, v.key, v.val::jsonb, v.descr
FROM erp_companies c
CROSS JOIN (VALUES
  ('general', 'password_policy', '{"min_length":12,"require_uppercase":true,"require_number":true,"require_special":true,"max_age_days":90}', 'Password policy'),
  ('general', 'session_timeout_minutes', '30', 'Inactivity logout'),
  ('integrations', 'etims_enabled', 'false', 'KRA eTIMS integration flag')
) AS v(category, key, val, descr)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_system_settings s
    WHERE s.company_id = c.id AND s.category = v.category AND s.setting_key = v.key
  );
