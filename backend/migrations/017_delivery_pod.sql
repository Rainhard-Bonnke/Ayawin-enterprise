-- Proof of delivery on delivery notes
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS pod_signature TEXT;
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS pod_photo_url TEXT;
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS pod_uploaded_at TIMESTAMPTZ;
