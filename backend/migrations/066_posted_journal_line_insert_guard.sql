CREATE OR REPLACE FUNCTION erp_block_posted_journal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  journal_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'erp_journals' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('posted','reversed') THEN
        RAISE EXCEPTION 'Posted journals cannot be deleted' USING ERRCODE='55000';
      END IF;
      RETURN OLD;
    END IF;

    IF OLD.status IN ('posted','reversed') AND NOT (
      OLD.status = 'posted' AND NEW.status = 'reversed'
      AND (to_jsonb(NEW) - ARRAY['status','updated_at','updated_by','reversed_by_id']) =
          (to_jsonb(OLD) - ARRAY['status','updated_at','updated_by','reversed_by_id'])
    ) THEN
      RAISE EXCEPTION 'Posted journals are immutable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT status INTO journal_status FROM erp_journals WHERE id=OLD.journal_id;
    IF journal_status IN ('posted','reversed') THEN
      RAISE EXCEPTION 'Lines on posted journals are immutable' USING ERRCODE='55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT status INTO journal_status FROM erp_journals WHERE id=NEW.journal_id;
  IF journal_status IN ('posted','reversed') THEN
    RAISE EXCEPTION 'Lines on posted journals are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS erp_journal_lines_immutable ON erp_journal_lines;
CREATE TRIGGER erp_journal_lines_immutable
BEFORE INSERT OR UPDATE OR DELETE ON erp_journal_lines
FOR EACH ROW EXECUTE FUNCTION erp_block_posted_journal_mutation();
