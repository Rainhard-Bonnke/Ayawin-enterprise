-- Module 1: Foundation & Auth (multi-tenant ERP core)
-- Run after legacy init.sql; coexists with legacy tables until module migration.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Global reference data (no company_id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_currencies (
  code CHAR(3) PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  decimal_places SMALLINT NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_languages (
  code VARCHAR(10) PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT,
  is_rtl BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
    'view', 'create', 'edit', 'delete', 'approve', 'export'
  ))
);

CREATE INDEX IF NOT EXISTS erp_permissions_module_idx ON erp_permissions (module);

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_registration_no TEXT,
  logo_url TEXT,
  base_currency_code CHAR(3) NOT NULL DEFAULT 'KES' REFERENCES erp_currencies (code),
  fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  default_language_code VARCHAR(10) NOT NULL DEFAULT 'en' REFERENCES erp_languages (code),
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS erp_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'KE',
  phone TEXT,
  email TEXT,
  is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS erp_branches_company_idx ON erp_branches (company_id);

CREATE TABLE IF NOT EXISTS erp_company_languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  language_code VARCHAR(10) NOT NULL REFERENCES erp_languages (code),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, language_code)
);

CREATE TABLE IF NOT EXISTS erp_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  from_currency_code CHAR(3) NOT NULL REFERENCES erp_currencies (code),
  to_currency_code CHAR(3) NOT NULL REFERENCES erp_currencies (code),
  rate NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
  effective_date DATE NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, from_currency_code, to_currency_code, effective_date)
);

CREATE INDEX IF NOT EXISTS erp_exchange_rates_company_date_idx
  ON erp_exchange_rates (company_id, effective_date DESC);

-- ---------------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS erp_roles_company_idx ON erp_roles (company_id);

CREATE TABLE IF NOT EXISTS erp_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  role_id UUID NOT NULL REFERENCES erp_roles (id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES erp_permissions (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS erp_role_permissions_role_idx ON erp_role_permissions (role_id);

-- ---------------------------------------------------------------------------
-- Users & access
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  default_branch_id UUID REFERENCES erp_branches (id),
  role_id UUID REFERENCES erp_roles (id),
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'locked', 'pending')),
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  timezone TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, email),
  UNIQUE (company_id, username)
);

CREATE INDEX IF NOT EXISTS erp_users_company_idx ON erp_users (company_id);
CREATE INDEX IF NOT EXISTS erp_users_role_idx ON erp_users (role_id);

CREATE TABLE IF NOT EXISTS erp_user_company_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL REFERENCES erp_users (id) ON DELETE CASCADE,
  granted_company_id UUID NOT NULL REFERENCES erp_companies (id),
  role_id UUID REFERENCES erp_roles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, granted_company_id)
);

CREATE TABLE IF NOT EXISTS erp_user_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL REFERENCES erp_users (id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES erp_branches (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS erp_user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL UNIQUE REFERENCES erp_users (id) ON DELETE CASCADE,
  job_title TEXT,
  department TEXT,
  avatar_url TEXT,
  notification_preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS erp_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL REFERENCES erp_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES erp_refresh_tokens (id),
  device_info TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS erp_refresh_tokens_user_idx ON erp_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS erp_refresh_tokens_expires_idx ON erp_refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS erp_user_mfa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL UNIQUE REFERENCES erp_users (id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  backup_codes_hash TEXT[],
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS erp_oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL REFERENCES erp_users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'saml', 'oidc')),
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS erp_ip_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID REFERENCES erp_users (id) ON DELETE CASCADE,
  role_id UUID REFERENCES erp_roles (id) ON DELETE CASCADE,
  cidr TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (user_id IS NOT NULL OR role_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS erp_password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  user_id UUID NOT NULL REFERENCES erp_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- System settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  category TEXT NOT NULL DEFAULT 'general',
  setting_key TEXT NOT NULL,
  setting_value JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, category, setting_key)
);

CREATE INDEX IF NOT EXISTS erp_system_settings_company_idx ON erp_system_settings (company_id);

-- ---------------------------------------------------------------------------
-- Audit log (partitioned by company + year)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS erp_audit_log_company_entity_idx
  ON erp_audit_log (company_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS erp_audit_log_company_user_idx
  ON erp_audit_log (company_id, user_id, created_at DESC);

-- Default partition for current + future years (bootstrap creates yearly partitions)
CREATE TABLE IF NOT EXISTS erp_audit_log_default PARTITION OF erp_audit_log DEFAULT;

-- ---------------------------------------------------------------------------
-- Migration tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erp_schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION erp_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_currencies', 'erp_languages', 'erp_permissions', 'erp_companies', 'erp_branches',
    'erp_company_languages', 'erp_exchange_rates', 'erp_roles', 'erp_role_permissions',
    'erp_users', 'erp_user_company_access', 'erp_user_branches', 'erp_user_profiles',
    'erp_refresh_tokens', 'erp_user_mfa', 'erp_oauth_accounts', 'erp_ip_whitelist',
    'erp_password_reset_tokens', 'erp_system_settings'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
