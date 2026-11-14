CREATE TABLE IF NOT EXISTS erp_document_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  document_type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 CHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_document_attachments_company_document_idx
  ON erp_document_attachments(company_id, document_type, document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS erp_document_attachments_sha256_idx
  ON erp_document_attachments(company_id, sha256);
