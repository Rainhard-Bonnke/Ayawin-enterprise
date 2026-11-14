ALTER TABLE erp_hr_future_effective_events
  ADD COLUMN IF NOT EXISTS decision_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES erp_users (id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE erp_hr_future_effective_events
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE erp_hr_future_effective_events
  DROP CONSTRAINT IF EXISTS erp_hr_future_effective_events_status_check;

ALTER TABLE erp_hr_future_effective_events
  ADD CONSTRAINT erp_hr_future_effective_events_status_check
  CHECK (status IN ('pending', 'scheduled', 'applied', 'cancelled'));