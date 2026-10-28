-- Backend-only intelligence runs and reviewable findings.

CREATE TABLE IF NOT EXISTS erp_ai_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  scenario TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'local',
  model TEXT,
  prompt_version TEXT NOT NULL DEFAULT 'inventory-v1',
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('running', 'completed', 'failed')),
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES erp_users (id)
);

CREATE INDEX IF NOT EXISTS erp_ai_analysis_runs_company_date_idx
  ON erp_ai_analysis_runs (company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS erp_ai_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  analysis_run_id UUID NOT NULL REFERENCES erp_ai_analysis_runs (id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  confidence NUMERIC(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  entity_type TEXT,
  entity_id TEXT,
  title TEXT NOT NULL,
  finding TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES erp_users (id)
);

CREATE INDEX IF NOT EXISTS erp_ai_findings_company_status_idx
  ON erp_ai_findings (company_id, status, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS erp_ai_findings_entity_idx
  ON erp_ai_findings (company_id, entity_type, entity_id, created_at DESC);