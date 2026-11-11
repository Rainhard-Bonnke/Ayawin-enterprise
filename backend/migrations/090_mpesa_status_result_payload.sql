ALTER TABLE erp_mpesa_payment_requests
  ADD COLUMN IF NOT EXISTS status_result_payload JSONB;