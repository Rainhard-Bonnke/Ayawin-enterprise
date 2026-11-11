ALTER TABLE erp_permissions DROP CONSTRAINT IF EXISTS erp_permissions_module_action_chk;
ALTER TABLE erp_permissions ADD CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
  'view','create','edit','delete','approve','export','price_override','discount_approve','credit_override',
  'order_create','order_approve','delivery_post','invoice_create','invoice_post','receipt_create','receipt_approve',
  'credit_note_create','credit_note_approve','prepare','production_certify','retry'
));

INSERT INTO erp_permissions (module,action,code,description)
VALUES ('integrations','retry','integrations.retry','Retry failed integration submissions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_role_permissions (company_id,role_id,permission_id)
SELECT role.company_id,role.id,permission.id
FROM erp_roles role CROSS JOIN erp_permissions permission
WHERE role.name IN ('Admin','System Administrator') AND permission.code='integrations.retry'
ON CONFLICT (role_id,permission_id) DO NOTHING;