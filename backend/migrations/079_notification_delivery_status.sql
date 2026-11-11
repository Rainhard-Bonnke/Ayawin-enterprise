ALTER TABLE erp_notification_outbox
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','delivered','failed','bounced'));

CREATE INDEX IF NOT EXISTS erp_notification_delivery_lookup_idx
  ON erp_notification_outbox (company_id, channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;