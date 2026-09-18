-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413174430.

-- ============================================================
-- UPDATED TRIGGER: ipd_treatments → covers medical/nursing/physio
-- (surgical/procedure already covered, diet excluded — covered by daily charges)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_ipd_treatment_to_billing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ci_id       uuid;
  v_price       numeric;
  v_found       boolean;
  v_inv_id      uuid;
  v_account_id  uuid;
  v_category    text;
BEGIN
  -- Skip diet — covered by ipd_daily_charges
  IF NEW.treatment_kind = 'diet' THEN
    RETURN NEW;
  END IF;

  -- Map treatment_kind to charge category
  v_category := CASE NEW.treatment_kind
    WHEN 'surgical'     THEN 'procedure'
    WHEN 'nursing'      THEN 'nursing'
    WHEN 'physio'       THEN 'procedure'
    WHEN 'medical'      THEN 'procedure'
    ELSE 'other'
  END;

  SELECT ci.charge_item_id, ci.unit_price, ci.definition_found
  INTO v_ci_id, v_price, v_found
  FROM public.create_charge_item_for_event(
    NEW.hospital_id, NEW.patient_id,
    v_category,
    NEW.name,
    'procedure',
    NEW.id,
    NULL,
    NEW.ordering_practitioner_id
  ) ci;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id  = NEW.hospital_id
    AND subject_id   = NEW.patient_id
    AND subject_type = 'Patient'
    AND status       = 'active'
  LIMIT 1;

  v_inv_id := public.get_or_create_rolling_invoice(
    NEW.hospital_id, NEW.patient_id, v_account_id,
    NULL, NEW.admission_id
  );

  PERFORM public.append_charge_to_invoice(v_inv_id, v_ci_id, NEW.name, v_price);

  UPDATE public.ipd_treatments SET charge_item_id = v_ci_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Recreate trigger (function replaced above)
DROP TRIGGER IF EXISTS trg_ipd_treatment_to_billing ON public.ipd_treatments;
CREATE TRIGGER trg_ipd_treatment_to_billing
  AFTER INSERT ON public.ipd_treatments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_ipd_treatment_to_billing();
