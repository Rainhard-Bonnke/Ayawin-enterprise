ALTER TABLE erp_integration_settings
  DROP CONSTRAINT IF EXISTS erp_integration_settings_provider_check;

ALTER TABLE erp_integration_settings
  ADD CONSTRAINT erp_integration_settings_provider_check
  CHECK (provider IN ('etims', 'mpesa', 'email', 'sms'));