ALTER TABLE erp_companies ADD COLUMN IF NOT EXISTS kra_pin TEXT;
ALTER TABLE erp_companies ADD COLUMN IF NOT EXISTS is_vat_registered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_companies ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE erp_customers ADD COLUMN IF NOT EXISTS is_vat_registered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_customers ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE erp_customers ADD COLUMN IF NOT EXISTS requires_tax_invoice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_vendors ADD COLUMN IF NOT EXISTS is_vat_registered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_vendors ADD COLUMN IF NOT EXISTS vat_number TEXT;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_companies_kra_pin_format_chk') THEN
  ALTER TABLE erp_companies ADD CONSTRAINT erp_companies_kra_pin_format_chk CHECK(kra_pin IS NULL OR kra_pin ~ '^[AP][0-9]{9}[A-Z]$');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_customers_tax_id_kra_format_chk') THEN
  ALTER TABLE erp_customers ADD CONSTRAINT erp_customers_tax_id_kra_format_chk CHECK(tax_id IS NULL OR tax_id ~ '^[AP][0-9]{9}[A-Z]$');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_vendors_tax_id_kra_format_chk') THEN
  ALTER TABLE erp_vendors ADD CONSTRAINT erp_vendors_tax_id_kra_format_chk CHECK(tax_id IS NULL OR tax_id ~ '^[AP][0-9]{9}[A-Z]$');
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS erp_companies_kra_pin_uq ON erp_companies(UPPER(kra_pin)) WHERE kra_pin IS NOT NULL AND is_deleted=FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_kra_pin_uq ON erp_customers(UPPER(tax_id)) WHERE tax_id IS NOT NULL AND is_deleted=FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS erp_vendors_kra_pin_uq ON erp_vendors(UPPER(tax_id)) WHERE tax_id IS NOT NULL AND is_deleted=FALSE;
