-- Encrypted salary components at rest (AES-256-GCM via PII_ENCRYPTION_KEY)

ALTER TABLE erp_employees
  ADD COLUMN IF NOT EXISTS basic_salary_enc TEXT;

ALTER TABLE erp_employee_contracts
  ADD COLUMN IF NOT EXISTS basic_salary_enc TEXT,
  ADD COLUMN IF NOT EXISTS house_allowance_enc TEXT,
  ADD COLUMN IF NOT EXISTS transport_allowance_enc TEXT;
