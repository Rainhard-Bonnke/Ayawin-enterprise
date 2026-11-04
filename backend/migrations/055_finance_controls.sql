ALTER TABLE erp_journals
  ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES erp_journals(id),
  ADD COLUMN IF NOT EXISTS reversed_by_id UUID REFERENCES erp_journals(id);

INSERT INTO erp_chart_of_accounts(company_id,account_code,account_name,account_type,level,is_postable)
SELECT c.id,'3200','Retained Earnings','equity',1,TRUE
FROM erp_companies c
WHERE NOT EXISTS (SELECT 1 FROM erp_chart_of_accounts a WHERE a.company_id=c.id AND a.account_code='3200');

INSERT INTO erp_system_settings(company_id,category,setting_key,setting_value,description)
SELECT c.id,'finance','manual_journal_maker_checker','true'::jsonb,'Require a different approver to post manual journals'
FROM erp_companies c
WHERE NOT EXISTS (SELECT 1 FROM erp_system_settings s WHERE s.company_id=c.id AND s.category='finance' AND s.setting_key='manual_journal_maker_checker');

CREATE OR REPLACE FUNCTION erp_block_posted_journal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'erp_journals' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('posted','reversed') THEN RAISE EXCEPTION 'Posted journals cannot be deleted' USING ERRCODE='55000'; END IF;
      RETURN OLD;
    END IF;
    IF OLD.status IN ('posted','reversed') AND NOT (
      OLD.status = 'posted' AND NEW.status = 'reversed'
      AND (to_jsonb(NEW) - ARRAY['status','updated_at','updated_by','reversed_by_id']) =
          (to_jsonb(OLD) - ARRAY['status','updated_at','updated_by','reversed_by_id'])
    ) THEN RAISE EXCEPTION 'Posted journals are immutable' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO journal_status FROM erp_journals WHERE id=OLD.journal_id;
    IF journal_status IN ('posted','reversed') THEN RAISE EXCEPTION 'Lines on posted journals are immutable' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO journal_status FROM erp_journals WHERE id=OLD.journal_id;
  IF journal_status IN ('posted','reversed') THEN RAISE EXCEPTION 'Lines on posted journals are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS erp_journals_immutable ON erp_journals;
CREATE TRIGGER erp_journals_immutable BEFORE UPDATE OR DELETE ON erp_journals
FOR EACH ROW EXECUTE FUNCTION erp_block_posted_journal_mutation();
DROP TRIGGER IF EXISTS erp_journal_lines_immutable ON erp_journal_lines;
CREATE TRIGGER erp_journal_lines_immutable BEFORE UPDATE OR DELETE ON erp_journal_lines
FOR EACH ROW EXECUTE FUNCTION erp_block_posted_journal_mutation();
