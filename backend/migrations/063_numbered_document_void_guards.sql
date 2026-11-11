ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE erp_customer_credit_notes ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE erp_customer_credit_notes ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_customer_credit_notes ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION erp_block_numbered_document_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_number TEXT;
BEGIN
 document_number := to_jsonb(OLD)->>TG_ARGV[0];
 IF document_number IS NOT NULL AND document_number NOT LIKE 'TMP-%' THEN
   RAISE EXCEPTION 'Numbered documents cannot be deleted; void the document with a reason' USING ERRCODE='55000';
 END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS erp_customer_invoice_no_hard_delete ON erp_customer_invoices;
CREATE TRIGGER erp_customer_invoice_no_hard_delete BEFORE DELETE ON erp_customer_invoices
 FOR EACH ROW EXECUTE FUNCTION erp_block_numbered_document_delete('invoice_no');
DROP TRIGGER IF EXISTS erp_customer_credit_note_no_hard_delete ON erp_customer_credit_notes;
CREATE TRIGGER erp_customer_credit_note_no_hard_delete BEFORE DELETE ON erp_customer_credit_notes
 FOR EACH ROW EXECUTE FUNCTION erp_block_numbered_document_delete('credit_note_no');
