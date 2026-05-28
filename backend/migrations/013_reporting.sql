-- Module 7: Reporting & BI

CREATE TABLE IF NOT EXISTS erp_saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT,
  query_config JSONB NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  saved_report_id UUID NOT NULL REFERENCES erp_saved_reports (id) ON DELETE CASCADE,
  cron_expression TEXT NOT NULL DEFAULT '0 8 1 * *',
  recipients TEXT[] NOT NULL DEFAULT '{}',
  format TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'pdf', 'xlsx')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS erp_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'general'
    CHECK (audience IN ('cfo', 'operations', 'hr', 'sales', 'general')),
  layout JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_kpi_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'number',
  target_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
  warning_threshold NUMERIC(18, 4),
  critical_threshold NUMERIC(18, 4),
  higher_is_better BOOLEAN NOT NULL DEFAULT TRUE,
  calc_type TEXT NOT NULL DEFAULT 'sql',
  calc_config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  kpi_id UUID NOT NULL REFERENCES erp_kpi_definitions (id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  actual_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
  target_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'green' CHECK (status IN ('green', 'amber', 'red')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kpi_id, period_date)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_saved_reports', 'erp_report_schedules', 'erp_dashboards', 'erp_kpi_definitions'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
