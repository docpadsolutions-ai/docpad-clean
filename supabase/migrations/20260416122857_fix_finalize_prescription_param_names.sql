-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416122857.

DROP FUNCTION IF EXISTS public.finalize_prescription(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.finalize_prescription(
  encounter_id uuid,
  hospital_id  uuid,
  patient_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id UUID;
  v_count           INT := 0;
BEGIN
  SELECT id INTO v_practitioner_id 
  FROM practitioners WHERE user_id = auth.uid();
  
  IF v_practitioner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Practitioner not found');
  END IF;

  SELECT COUNT(*) INTO v_count 
  FROM prescriptions
  WHERE prescriptions.encounter_id = finalize_prescription.encounter_id AND status = 'ordered';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No medications to finalize');
  END IF;

  UPDATE prescriptions
  SET 
    status       = 'final',
    finalized_at = now(),
    finalized_by = v_practitioner_id
  WHERE prescriptions.encounter_id = finalize_prescription.encounter_id AND status = 'ordered';

  UPDATE opd_encounters
  SET 
    prescription_finalized_at = now(),
    prescription_finalized_by = v_practitioner_id
  WHERE id = finalize_prescription.encounter_id;

  RETURN jsonb_build_object(
    'success',         true,
    'drugs_finalized', v_count,
    'message',         'Prescription finalized and sent to pharmacy'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
