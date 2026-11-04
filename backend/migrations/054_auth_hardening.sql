ALTER TABLE erp_user_mfa
  ADD COLUMN IF NOT EXISTS pending_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS last_used_step BIGINT;
