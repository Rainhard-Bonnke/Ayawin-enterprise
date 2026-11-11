CREATE UNIQUE INDEX IF NOT EXISTS erp_mpesa_b2c_originator_uidx
  ON erp_mpesa_b2c_refund_requests (company_id, originator_conversation_id)
  WHERE originator_conversation_id IS NOT NULL;