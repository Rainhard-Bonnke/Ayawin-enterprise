ALTER TABLE erp_mpesa_payment_requests
  DROP CONSTRAINT IF EXISTS erp_mpesa_payment_requests_status_check;

ALTER TABLE erp_mpesa_payment_requests
  ADD CONSTRAINT erp_mpesa_payment_requests_status_check
  CHECK (status IN ('pending','processing','awaiting_callback','callback_received','awaiting_status_callback','confirmed','failed','cancelled','timeout'));

ALTER TABLE erp_mpesa_payment_requests
  ADD COLUMN IF NOT EXISTS status_query_originator_id TEXT,
  ADD COLUMN IF NOT EXISTS status_query_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS status_query_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS erp_mpesa_status_query_originator_uidx
  ON erp_mpesa_payment_requests (company_id,status_query_originator_id)
  WHERE status_query_originator_id IS NOT NULL;