ALTER TABLE erp_employee_documents
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE erp_employee_dependants
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES erp_users(id),
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

DROP TRIGGER IF EXISTS trg_erp_employee_documents_updated_at ON erp_employee_documents;
CREATE TRIGGER trg_erp_employee_documents_updated_at
  BEFORE UPDATE ON erp_employee_documents
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();

DROP TRIGGER IF EXISTS trg_erp_employee_dependants_updated_at ON erp_employee_dependants;
CREATE TRIGGER trg_erp_employee_dependants_updated_at
  BEFORE UPDATE ON erp_employee_dependants
  FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at();
