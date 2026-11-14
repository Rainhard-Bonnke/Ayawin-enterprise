CREATE TABLE IF NOT EXISTS erp_delivery_proof_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  delivery_note_id UUID NOT NULL REFERENCES erp_delivery_notes(id),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 CHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS erp_delivery_proof_attachments_delivery_idx
  ON erp_delivery_proof_attachments(company_id, delivery_note_id, created_at DESC);
