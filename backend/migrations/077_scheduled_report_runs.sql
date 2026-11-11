ALTER TABLE erp_report_schedules
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS erp_report_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  schedule_id UUID NOT NULL REFERENCES erp_report_schedules (id) ON DELETE CASCADE,
  saved_report_id UUID NOT NULL REFERENCES erp_saved_reports (id),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  filename TEXT,
  storage_path TEXT,
  file_size_bytes BIGINT,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS erp_report_schedule_runs_history_idx
  ON erp_report_schedule_runs (company_id, schedule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS erp_report_schedules_due_idx
  ON erp_report_schedules (next_run_at, lease_until)
  WHERE is_active = TRUE AND is_deleted = FALSE;