ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS issuer_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS issuer_snapshot_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION erp_prevent_issued_invoice_issuer_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.issuer_snapshot IS NOT NULL
     AND (NEW.issuer_snapshot IS DISTINCT FROM OLD.issuer_snapshot
       OR NEW.issuer_snapshot_at IS DISTINCT FROM OLD.issuer_snapshot_at) THEN
    RAISE EXCEPTION 'Issued invoice issuer snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS erp_customer_invoice_issuer_snapshot_immutable ON erp_customer_invoices;
CREATE TRIGGER erp_customer_invoice_issuer_snapshot_immutable
BEFORE UPDATE ON erp_customer_invoices
FOR EACH ROW EXECUTE FUNCTION erp_prevent_issued_invoice_issuer_snapshot_mutation();