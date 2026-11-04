CREATE TABLE IF NOT EXISTS erp_document_sequences (
 company_id UUID NOT NULL REFERENCES erp_companies(id), doc_type TEXT NOT NULL,
 fiscal_year INTEGER NOT NULL, last_number BIGINT NOT NULL DEFAULT 0 CHECK(last_number>=0),
 prefix TEXT NOT NULL, padding INTEGER NOT NULL DEFAULT 4 CHECK(padding BETWEEN 1 AND 12),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(company_id,doc_type,fiscal_year)
);

-- Seed each sequence from the highest existing number for that type/year.
DO $$
DECLARE item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('erp_sales_orders','sales_order','SO','order_no'),('erp_delivery_notes','delivery_note','DN','delivery_no'),
  ('erp_customer_invoices','customer_invoice','INV','invoice_no'),('erp_customer_credit_notes','customer_credit_note','CN','credit_note_no'),
  ('erp_customer_receipts','customer_receipt','RCP','receipt_no'),('erp_journals','journal','JE','journal_no')
 ) AS source(table_name,doc_type,prefix,column_name)
 LOOP
  EXECUTE format(
   'INSERT INTO erp_document_sequences(company_id,doc_type,fiscal_year,last_number,prefix,padding)
    SELECT company_id,$1,parts.year,MAX(parts.num),$2,4 FROM (
     SELECT company_id,substring(doc_no from ''%s-([0-9]{4})-([0-9]+)$'')::int AS year,
            substring(doc_no from ''%s-[0-9]{4}-([0-9]+)$'')::bigint AS num
     FROM (SELECT company_id, %I::text AS doc_no FROM %I) records
     WHERE doc_no ~ ''%s-[0-9]{4}-[0-9]+$''
    ) parts GROUP BY company_id,parts.year
    ON CONFLICT(company_id,doc_type,fiscal_year) DO UPDATE
      SET last_number=GREATEST(erp_document_sequences.last_number,EXCLUDED.last_number)'
   ,item.prefix,item.prefix,item.column_name,item.table_name,item.prefix)
   USING item.doc_type,item.prefix;
 END LOOP;
END $$;

ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_customer_invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE erp_customer_credit_notes ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE erp_customer_credit_notes ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES erp_users(id);
ALTER TABLE erp_customer_credit_notes ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

DO $$ DECLARE constraint_name TEXT; BEGIN
 SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='erp_customer_invoices'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%';
 IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE erp_customer_invoices DROP CONSTRAINT %I',constraint_name); END IF;
 ALTER TABLE erp_customer_invoices ADD CONSTRAINT erp_customer_invoices_status_chk CHECK(status IN ('draft','posted','paid','partial','overdue','cancelled','void'));
 SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='erp_customer_credit_notes'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%';
 IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE erp_customer_credit_notes DROP CONSTRAINT %I',constraint_name); END IF;
 ALTER TABLE erp_customer_credit_notes ADD CONSTRAINT erp_customer_credit_notes_status_chk CHECK(status IN ('draft','posted','void'));
END $$;

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
