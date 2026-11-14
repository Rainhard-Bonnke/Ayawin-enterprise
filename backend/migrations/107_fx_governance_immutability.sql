CREATE OR REPLACE FUNCTION erp_guard_exchange_rate_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Exchange-rate records are immutable; use an explicit rejected record for correction'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY[
        'status','approved_by','approved_at','rejected_by','rejected_at','decision_reason',
        'updated_by','updated_at','is_deleted'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'status','approved_by','approved_at','rejected_by','rejected_at','decision_reason',
        'updated_by','updated_at','is_deleted'
      ]) THEN
    RAISE EXCEPTION 'Exchange-rate terms are immutable; create a replacement record'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Reviewed exchange-rate records are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Draft exchange rates may only be approved or rejected'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS erp_exchange_rates_immutable ON erp_exchange_rates;
CREATE TRIGGER erp_exchange_rates_immutable
BEFORE UPDATE OR DELETE ON erp_exchange_rates
FOR EACH ROW EXECUTE FUNCTION erp_guard_exchange_rate_immutability();

CREATE OR REPLACE FUNCTION erp_guard_fx_policy_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FX accounting policies are immutable; create a replacement policy'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY[
        'status','approved_by','approved_at','rejected_by','rejected_at','decision_reason',
        'superseded_by','superseded_at','superseded_by_user_id','updated_by','updated_at','is_deleted'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'status','approved_by','approved_at','rejected_by','rejected_at','decision_reason',
        'superseded_by','superseded_at','superseded_by_user_id','updated_by','updated_at','is_deleted'
      ]) THEN
    RAISE EXCEPTION 'FX policy terms are immutable; create a replacement policy'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'draft' AND NEW.status IN ('approved','rejected') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
     AND NEW.superseded_by IS NOT NULL AND NEW.superseded_at IS NOT NULL
     AND NEW.superseded_by_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'FX policy state transition is not permitted'
    USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS erp_fx_accounting_policies_immutable ON erp_fx_accounting_policies;
CREATE TRIGGER erp_fx_accounting_policies_immutable
BEFORE UPDATE OR DELETE ON erp_fx_accounting_policies
FOR EACH ROW EXECUTE FUNCTION erp_guard_fx_policy_immutability();