ALTER TABLE erp_manpower_requisitions
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES erp_users(id);

ALTER TABLE erp_candidate_offers
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES erp_users(id);

UPDATE erp_manpower_requisitions
SET created_by = requested_by
WHERE created_by IS NULL AND requested_by IS NOT NULL;

UPDATE erp_candidate_offers
SET created_by = approved_by
WHERE created_by IS NULL AND approved_by IS NOT NULL;

DROP TRIGGER IF EXISTS trg_erp_manpower_requisitions_updated_at ON erp_manpower_requisitions;
CREATE TRIGGER trg_erp_manpower_requisitions_updated_at
  BEFORE UPDATE ON erp_manpower_requisitions
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();

DROP TRIGGER IF EXISTS trg_erp_candidate_offers_updated_at ON erp_candidate_offers;
CREATE TRIGGER trg_erp_candidate_offers_updated_at
  BEFORE UPDATE ON erp_candidate_offers
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();
