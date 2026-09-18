-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417153350.

CREATE OR REPLACE FUNCTION public.log_nursing_procedure(
  p_admission_id uuid,
  p_charge_item_def_id uuid,
  p_performed_at timestamptz,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_practitioner_id uuid;
  v_hospital_id uuid;
  v_patient_id uuid;
  v_procedure_name text;
  v_procedure_code text;
  v_log_id uuid;
BEGIN
  -- Get practitioner from auth
  SELECT id, hospital_id INTO v_practitioner_id, v_hospital_id
  FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  IF v_practitioner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated as practitioner');
  END IF;

  -- Get patient from admission
  SELECT patient_id INTO v_patient_id
  FROM ipd_admissions
  WHERE id = p_admission_id AND hospital_id = v_hospital_id;

  IF v_patient_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admission not found');
  END IF;

  -- Get procedure name from charge item definition
  SELECT display_name, code INTO v_procedure_name, v_procedure_code
  FROM charge_item_definitions
  WHERE id = p_charge_item_def_id AND hospital_id = v_hospital_id;

  IF v_procedure_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Procedure definition not found');
  END IF;

  -- Insert the log
  INSERT INTO nursing_procedure_logs (
    hospital_id,
    patient_id,
    admission_id,
    charge_item_def_id,
    procedure_name,
    procedure_code,
    performed_at,
    performed_by,
    notes,
    is_billed
  ) VALUES (
    v_hospital_id,
    v_patient_id,
    p_admission_id,
    p_charge_item_def_id,
    v_procedure_name,
    v_procedure_code,
    p_performed_at,
    v_practitioner_id,
    p_notes,
    false
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('success', true, 'id', v_log_id);
END;
$function$;

NOTIFY pgrst, 'reload schema';
