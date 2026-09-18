-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415081606.

CREATE OR REPLACE FUNCTION acknowledge_investigation(
  p_investigation_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_action_taken TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id UUID;
  v_patient_id UUID;
  v_practitioner_id UUID;
  v_ack_id UUID;
BEGIN
  -- Get hospital_id and patient_id from the investigation
  SELECT hospital_id, patient_id INTO v_hospital_id, v_patient_id
  FROM investigations WHERE id = p_investigation_id;

  IF v_hospital_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Investigation not found');
  END IF;

  -- Get practitioner id
  SELECT id INTO v_practitioner_id
  FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  -- Insert acknowledgement
  INSERT INTO investigation_acknowledgements (
    investigation_id,
    patient_id,
    hospital_id,
    acknowledged_by,
    practitioner_id,
    acknowledged_at,
    notes,
    reason,
    action_taken,
    result_severity_at_ack
  )
  SELECT
    p_investigation_id,
    v_patient_id,
    v_hospital_id,
    auth.uid(),
    v_practitioner_id,
    now(),
    p_notes,
    p_reason,
    p_action_taken,
    i.result_severity
  FROM investigations i WHERE i.id = p_investigation_id
  RETURNING id INTO v_ack_id;

  -- Update acknowledged_at on the investigation itself
  UPDATE investigations
  SET acknowledged_at = now(),
      result_status = 'reviewed'
  WHERE id = p_investigation_id;

  RETURN json_build_object('success', true, 'acknowledgement_id', v_ack_id);
END;
$$;

GRANT EXECUTE ON FUNCTION acknowledge_investigation TO authenticated;
