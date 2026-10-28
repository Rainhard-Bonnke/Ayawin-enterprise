-- Mobile stock locations and controlled physical stock counts.
ALTER TABLE erp_warehouses
  ADD COLUMN IF NOT EXISTS location_type TEXT NOT NULL DEFAULT 'warehouse',
  ADD COLUMN IF NOT EXISTS vehicle_registration TEXT,
  ADD COLUMN IF NOT EXISTS assigned_driver_user_id UUID REFERENCES erp_users (id);

DO $$ BEGIN
  ALTER TABLE erp_warehouses ADD CONSTRAINT erp_warehouses_location_type_check
    CHECK (location_type IN ('warehouse', 'vehicle'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS erp_warehouses_vehicle_registration_uidx
  ON erp_warehouses (company_id, UPPER(vehicle_registration))
  WHERE location_type = 'vehicle' AND vehicle_registration IS NOT NULL AND is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS erp_stocktake_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  count_no TEXT NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'counting'
    CHECK (status IN ('counting', 'submitted', 'recount_required', 'posted', 'rejected')),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES erp_users (id),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES erp_users (id),
  review_note TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, count_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_stocktake_one_open_per_location_uidx
  ON erp_stocktake_sessions (company_id, warehouse_id)
  WHERE status IN ('counting', 'submitted');
CREATE INDEX IF NOT EXISTS erp_stocktake_company_status_date_idx
  ON erp_stocktake_sessions (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS erp_stocktake_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  stocktake_id UUID NOT NULL REFERENCES erp_stocktake_sessions (id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES erp_items (id),
  expected_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(18, 4),
  variance NUMERIC(18, 4),
  notes TEXT,
  counted_at TIMESTAMPTZ,
  counted_by UUID REFERENCES erp_users (id),
  UNIQUE (stocktake_id, item_id)
);

CREATE INDEX IF NOT EXISTS erp_stocktake_lines_company_session_idx
  ON erp_stocktake_lines (company_id, stocktake_id);

INSERT INTO erp_permissions (module, action, code, description) VALUES
  ('fleet', 'view', 'fleet.view', 'View driver stock locations and counts'),
  ('fleet', 'create', 'fleet.load', 'Create vehicle stock locations and load stock'),
  ('fleet', 'create', 'fleet.count', 'Enter and submit physical stock counts'),
  ('fleet', 'approve', 'fleet.approve', 'Review and post physical count variances')
ON CONFLICT (code) DO NOTHING;

-- Grant only the fleet actions appropriate to the standard roles, where those
-- roles exist. Custom role permissions remain under company administration.
INSERT INTO erp_role_permissions (company_id, role_id, permission_id)
SELECT r.company_id, r.id, p.id
FROM erp_roles r
JOIN erp_permissions p ON p.code = ANY(CASE
  WHEN LOWER(r.name) IN ('system administrator', 'admin', 'manager', 'operations manager', 'store manager')
    THEN ARRAY['fleet.view', 'fleet.load', 'fleet.count', 'fleet.approve']
  WHEN LOWER(r.name) IN ('warehouse', 'warehouse officer', 'warehouse supervisor')
    THEN ARRAY['fleet.view', 'fleet.load', 'fleet.count']
  WHEN LOWER(r.name) IN ('driver', 'delivery driver')
    THEN ARRAY['fleet.view', 'fleet.count']
  ELSE ARRAY[]::TEXT[] END)
WHERE r.is_deleted = FALSE
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_deleted = FALSE, updated_at = NOW();
