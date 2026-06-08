-- Delivery & logistics: drivers, zones, mileage, re-delivery tasks

ALTER TABLE erp_customers ADD COLUMN IF NOT EXISTS delivery_zone TEXT;

ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES erp_employees (id);
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS vehicle_id UUID;
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS delivery_zone TEXT;
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS logistics_status TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE erp_delivery_notes ADD COLUMN IF NOT EXISTS parent_delivery_id UUID REFERENCES erp_delivery_notes (id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_delivery_notes_logistics_status_check'
  ) THEN
    ALTER TABLE erp_delivery_notes ADD CONSTRAINT erp_delivery_notes_logistics_status_check
      CHECK (logistics_status IN ('scheduled', 'in_transit', 'delivered', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS erp_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  plate_no TEXT NOT NULL,
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, plate_no)
);

ALTER TABLE erp_delivery_notes
  DROP CONSTRAINT IF EXISTS erp_delivery_notes_vehicle_id_fkey;
ALTER TABLE erp_delivery_notes
  ADD CONSTRAINT erp_delivery_notes_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES erp_vehicles (id);

CREATE TABLE IF NOT EXISTS erp_vehicle_mileage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  vehicle_id UUID NOT NULL REFERENCES erp_vehicles (id),
  delivery_id UUID REFERENCES erp_delivery_notes (id),
  driver_id UUID REFERENCES erp_employees (id),
  trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
  odometer_start NUMERIC(12, 2),
  odometer_end NUMERIC(12, 2),
  distance_km NUMERIC(12, 2) NOT NULL DEFAULT 0,
  route_zone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE TABLE IF NOT EXISTS erp_delivery_redelivery_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies (id),
  sales_order_id UUID NOT NULL REFERENCES erp_sales_orders (id),
  failed_delivery_id UUID NOT NULL REFERENCES erp_delivery_notes (id),
  task_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'scheduled', 'completed', 'cancelled')),
  scheduled_date DATE,
  driver_id UUID REFERENCES erp_employees (id),
  failure_reason TEXT,
  new_delivery_id UUID REFERENCES erp_delivery_notes (id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, task_no)
);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_driver_status
  ON erp_delivery_notes (company_id, driver_id, logistics_status)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_delivery_notes_zone
  ON erp_delivery_notes (company_id, delivery_zone, delivery_date)
  WHERE is_deleted = FALSE;

INSERT INTO erp_vehicles (company_id, plate_no, name)
SELECT c.id, 'KDA 001M', 'Delivery Van 1'
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_vehicles v WHERE v.company_id = c.id AND v.plate_no = 'KDA 001M');

UPDATE erp_delivery_notes d
SET logistics_status = CASE WHEN d.status = 'posted' THEN 'delivered' WHEN d.status = 'cancelled' THEN 'failed' ELSE 'scheduled' END
WHERE d.logistics_status IS NULL OR d.logistics_status = 'scheduled';
