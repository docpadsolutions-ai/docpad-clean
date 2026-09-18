-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417153826.

CREATE OR REPLACE FUNCTION public.auto_bill_nursing_procedure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_def   charge_item_definitions%ROWTYPE;
  v_ci_id UUID;
  v_price NUMERIC;
BEGIN
  IF NEW.charge_item_def_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_def FROM charge_item_definitions WHERE id = NEW.charge_item_def_id;
  v_price := COALESCE(v_def.base_price, 0);

  INSERT INTO charge_items (
    hospital_id,
    patient_id,
    encounter_id,          -- NULL for IPD nursing procedures (FK refs opd_encounters)
    definition_id,
    charge_code,
    charge_code_system,
    charge_code_display,
    category,
    status,
    quantity_value,
    quantity_unit,
    unit_price,
    unit_price_snapshot,
    net_amount,
    source_type,
    source_id,
    service_period_start,
    service_period_end,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    NEW.hospital_id,
    NEW.patient_id,
    NULL,                  -- NOT the admission_id; encounter_id FK is opd_encounters only
    v_def.id,
    COALESCE(v_def.code, 'PROCEDURE'),
    COALESCE(v_def.code_system, 'local'),
    COALESCE(v_def.display_name, NEW.procedure_name),
    COALESCE(v_def.category, 'nursing_procedure'),
    'billable',
    1,
    'procedure',
    v_price,
    v_price,
    v_price,
    'nursing_procedure',
    NEW.id,
    NEW.performed_at,
    NEW.performed_at,
    NEW.performed_by,
    now(),
    now()
  )
  RETURNING id INTO v_ci_id;

  UPDATE nursing_procedure_logs
  SET charge_item_id = v_ci_id, is_billed = true
  WHERE id = NEW.id;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
