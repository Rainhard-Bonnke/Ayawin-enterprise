CREATE TABLE IF NOT EXISTS erp_etims_invoice_sequences (
  company_id UUID PRIMARY KEY REFERENCES erp_companies (id),
  next_invoice_no BIGINT NOT NULL DEFAULT 1 CHECK (next_invoice_no > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE erp_customer_invoices
  ADD COLUMN IF NOT EXISTS etims_kra_invoice_no BIGINT;