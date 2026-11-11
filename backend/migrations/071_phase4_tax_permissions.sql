ALTER TABLE erp_permissions DROP CONSTRAINT IF EXISTS erp_permissions_module_action_chk;
ALTER TABLE erp_permissions ADD CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
  'view','create','edit','delete','approve','export','price_override','discount_approve','credit_override',
  'order_create','order_approve','delivery_post','invoice_create','invoice_post','receipt_create','receipt_approve',
  'credit_note_create','credit_note_approve','prepare'
));

INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('tax', 'view', 'tax.view', 'View tax schedules and working papers'),
  ('tax', 'prepare', 'tax.prepare', 'Prepare tax schedules and working papers'),
  ('tax', 'approve', 'tax.approve', 'Approve tax schedules and verify tax evidence'),
  ('tax', 'edit', 'tax.edit', 'Override item tax defaults on supplier documents'),
  ('tax', 'export', 'tax.export', 'Export tax schedules and working papers')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
CROSS JOIN erp_permissions p
WHERE (r.name IN ('Admin', 'System Administrator', 'Accountant')
       AND p.code IN ('tax.view', 'tax.prepare', 'tax.approve', 'tax.edit', 'tax.export'))
   OR (r.name IN ('Manager', 'Operations Manager') AND p.code IN ('tax.view'))
ON CONFLICT (role_id, permission_id) DO NOTHING;