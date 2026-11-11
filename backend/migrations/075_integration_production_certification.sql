ALTER TABLE erp_integration_settings
  DROP CONSTRAINT IF EXISTS erp_integration_settings_provider_mode_check;

ALTER TABLE erp_integration_settings
  ADD CONSTRAINT erp_integration_settings_provider_mode_check
  CHECK (provider_mode IN ('disabled', 'mock', 'sandbox', 'production'));

DROP INDEX IF EXISTS erp_integration_settings_branch_uidx;
DROP INDEX IF EXISTS erp_integration_settings_company_uidx;

CREATE UNIQUE INDEX erp_integration_settings_branch_uidx
  ON erp_integration_settings (company_id, branch_id, provider, environment)
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX erp_integration_settings_company_uidx
  ON erp_integration_settings (company_id, provider, environment)
  WHERE branch_id IS NULL;

CREATE TABLE IF NOT EXISTS erp_integration_certifications (
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  provider TEXT NOT NULL CHECK (provider IN ('etims', 'mpesa')),
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  certified_by UUID NOT NULL REFERENCES erp_users (id),
  certified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, provider)
);

ALTER TABLE erp_permissions DROP CONSTRAINT IF EXISTS erp_permissions_module_action_chk;
ALTER TABLE erp_permissions ADD CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
  'view','create','edit','delete','approve','export','price_override','discount_approve','credit_override',
  'order_create','order_approve','delivery_post','invoice_create','invoice_post','receipt_create','receipt_approve',
  'credit_note_create','credit_note_approve','prepare','production_certify'
));

INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('integrations', 'production_certify', 'integrations.production_certify', 'Certify a company integration for production use')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
CROSS JOIN erp_permissions p
WHERE r.name IN ('Admin', 'System Administrator')
  AND p.code = 'integrations.production_certify'
ON CONFLICT (role_id, permission_id) DO NOTHING;