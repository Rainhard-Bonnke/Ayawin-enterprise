-- Audit log rows cannot be updated or deleted (application has no API; enforce at DB layer).

CREATE OR REPLACE FUNCTION erp_prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'erp_audit_log is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_erp_audit_log_immutable ON erp_audit_log;
CREATE TRIGGER trg_erp_audit_log_immutable
  BEFORE UPDATE OR DELETE ON erp_audit_log
  FOR EACH ROW EXECUTE FUNCTION erp_prevent_audit_mutation();
