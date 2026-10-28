ALTER TABLE erp_inventory_lot_events
  DROP CONSTRAINT IF EXISTS erp_inventory_lot_events_event_type_check;
ALTER TABLE erp_inventory_lot_events
  ADD CONSTRAINT erp_inventory_lot_events_event_type_check
  CHECK (event_type IN ('quarantined', 'released', 'written_off', 'supplier_returned'));

ALTER TABLE erp_inventory_quarantine_events
  DROP CONSTRAINT IF EXISTS erp_inventory_quarantine_events_event_type_check;
ALTER TABLE erp_inventory_quarantine_events
  ADD CONSTRAINT erp_inventory_quarantine_events_event_type_check
  CHECK (event_type IN ('quarantined', 'released', 'written_off', 'supplier_returned'));

CREATE TABLE IF NOT EXISTS erp_inventory_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  disposition_no TEXT NOT NULL,
  disposition_type TEXT NOT NULL CHECK (disposition_type IN ('release', 'write_off', 'supplier_return')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  reason TEXT NOT NULL,
  vendor_id UUID REFERENCES erp_vendors(id),
  reference_no TEXT,
  offset_account_id UUID REFERENCES erp_chart_of_accounts(id),
  journal_id UUID REFERENCES erp_journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  created_by UUID REFERENCES erp_users(id),
  posted_by UUID REFERENCES erp_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES erp_users(id),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (company_id, disposition_no),
  CHECK ((disposition_type = 'supplier_return' AND vendor_id IS NOT NULL)
      OR (disposition_type <> 'supplier_return' AND vendor_id IS NULL))
);

CREATE TABLE IF NOT EXISTS erp_inventory_disposition_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  disposition_id UUID NOT NULL REFERENCES erp_inventory_dispositions(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES erp_warehouses(id),
  item_id UUID NOT NULL REFERENCES erp_items(id),
  lot_id UUID REFERENCES erp_inventory_lots(id),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES erp_users(id),
  UNIQUE (disposition_id)
);

CREATE INDEX IF NOT EXISTS erp_inventory_dispositions_register_idx
  ON erp_inventory_dispositions(company_id, status, created_at DESC)
  WHERE is_deleted = FALSE;
