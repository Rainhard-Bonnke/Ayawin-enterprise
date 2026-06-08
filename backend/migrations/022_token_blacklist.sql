-- Revoked JWT access tokens (by jti) until natural expiry

CREATE TABLE IF NOT EXISTS erp_revoked_access_tokens (
  jti TEXT PRIMARY KEY,
  user_id UUID REFERENCES erp_users (id),
  company_id UUID REFERENCES erp_companies (id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON erp_revoked_access_tokens (expires_at);
