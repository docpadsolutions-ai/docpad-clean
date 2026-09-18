-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411120244.

-- Fix 1: upsert_dpn_note — defensive hospital_day calc
CREATE OR REPLACE FUNCTION upsert_dpn_note(
  p_admission_id     uuid,
  p_hospital_id      uuid,
  p_patient_id       uuid,
  p_note_date        date,
  p_authored_by      uuid DEFAULT NULL,
  p_subjective_text  text DEFAULT NULL,
  p_appetite         text DEFAULT NULL,
  p_sleep_ok         boolean DEFAULT NULL,
  p_bowel_ok         boolean DEFAULT NULL,
  p_bladder_ok       boolean DEFAULT NULL,
  p_objective_text   text DEFAULT NULL,
  p_assessment_text  text DEFAULT NULL,
  p_plan_text        text DEFAULT NULL,
  p_plan_narrative   text DEFAULT NULL,
  p_condition_status text DEFAULT NULL,
  p_medical_surgical_notes text DEFAULT NULL,
  p_note_id          uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_note_id        uuid;
  v_hospital_day   integer;
  v_post_op_day    integer;
  v_admitted_at    date;
  v_surgery_date   date;
BEGIN
  SELECT admitted_at::date, surgery_date
  INTO v_admitted_at, v_surgery_date
  FROM ipd_admissions WHERE id = p_admission_id;

  -- Defensive: if admitted_at is null or same as note_date, day = 1
  v_hospital_day := GREATEST(1, (p_note_date - COALESCE(v_admitted_at, p_note_date)) + 1);
  v_post_op_day  := CASE WHEN v_surgery_date IS NOT NULL
                    THEN GREATEST(1, (p_note_date - v_surgery_date) + 1)
                    ELSE NULL END;

  IF p_note_id IS NOT NULL THEN
    UPDATE ipd_progress_notes SET
      subjective_text        = COALESCE(p_subjective_text, subjective_text),
      appetite               = COALESCE(p_appetite, appetite),
      sleep_ok               = COALESCE(p_sleep_ok, sleep_ok),
      bowel_ok               = COALESCE(p_bowel_ok, bowel_ok),
      bladder_ok             = COALESCE(p_bladder_ok, bladder_ok),
      objective_text         = COALESCE(p_objective_text, objective_text),
      assessment_text        = COALESCE(p_assessment_text, assessment_text),
      plan_text              = COALESCE(p_plan_text, plan_text),
      plan_narrative         = COALESCE(p_plan_narrative, plan_narrative),
      condition_status       = COALESCE(p_condition_status, condition_status),
      medical_surgical_notes = COALESCE(p_medical_surgical_notes, medical_surgical_notes),
      hospital_day_number    = v_hospital_day,
      post_op_day            = v_post_op_day,
      updated_at             = now()
    WHERE id = p_note_id AND status = 'draft'
    RETURNING id INTO v_note_id;
  ELSE
    INSERT INTO ipd_progress_notes (
      hospital_id, admission_id, patient_id, note_date,
      hospital_day_number, post_op_day, authored_by,
      subjective_text, appetite, sleep_ok, bowel_ok, bladder_ok,
      objective_text, assessment_text, plan_text, plan_narrative,
      condition_status, medical_surgical_notes, status
    ) VALUES (
      p_hospital_id, p_admission_id, p_patient_id, p_note_date,
      v_hospital_day, v_post_op_day, p_authored_by,
      p_subjective_text, p_appetite, p_sleep_ok, p_bowel_ok, p_bladder_ok,
      p_objective_text, p_assessment_text, p_plan_text, p_plan_narrative,
      p_condition_status, p_medical_surgical_notes, 'draft'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_note_id;
  END IF;

  IF p_condition_status IS NOT NULL AND v_note_id IS NOT NULL THEN
    INSERT INTO ipd_condition_timeline (
      hospital_id, admission_id, patient_id, progress_note_id,
      recorded_date, hospital_day, condition_status, recorded_by
    ) VALUES (
      p_hospital_id, p_admission_id, p_patient_id, v_note_id,
      p_note_date, v_hospital_day, p_condition_status, p_authored_by
    )
    ON CONFLICT (admission_id, recorded_date)
    DO UPDATE SET condition_status = EXCLUDED.condition_status;
  END IF;

  RETURN v_note_id;
END;
$$;

-- Fix 2: patch existing notes hospital_day_number = 0 → 1
UPDATE ipd_progress_notes SET hospital_day_number = 1 WHERE hospital_day_number = 0;

-- Fix 3: get_dpn_right_panel with surgeon name + formatted date + diagnosis fallback
DROP FUNCTION IF EXISTS get_dpn_right_panel(uuid);

CREATE OR REPLACE FUNCTION get_dpn_right_panel(p_admission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'admission',  row_to_json(a.*),
    'diagnosis',  COALESCE(a.primary_diagnosis_display, a.primary_diagnosis_icd10, 'Not set'),
    'admitted_formatted', TO_CHAR(a.admitted_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY'),
    'surgeon_name', (SELECT full_name FROM practitioners p WHERE p.id = a.admitting_doctor_id),
    'patient',    (SELECT jsonb_build_object(
                    'id', pt.id, 'name', pt.full_name, 'dob', pt.date_of_birth,
                    'gender', pt.gender, 'uhid', pt.uhid
                  ) FROM patients pt WHERE pt.id = a.patient_id),
    'ward',       (SELECT jsonb_build_object('name', w.name, 'code', w.code)
                  FROM ipd_wards w WHERE w.id = a.ward_id),
    'bed',        (SELECT jsonb_build_object('number', b.bed_number, 'type', b.bed_type)
                  FROM ipd_beds b WHERE b.id = a.bed_id),
    'condition_trend', (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'day', ct.hospital_day, 'date', ct.recorded_date,
                      'status', ct.condition_status
                    ) ORDER BY ct.hospital_day ASC
                  )
                  FROM ipd_condition_timeline ct WHERE ct.admission_id = p_admission_id),
    'pending_investigations', (
                  SELECT jsonb_agg(row_to_json(io.*))
                  FROM ipd_investigation_orders io
                  WHERE io.admission_id = p_admission_id
                  AND io.status NOT IN ('reported','cancelled')
                  ORDER BY io.ordered_date DESC),
    'critical_alerts', (
                  SELECT jsonb_agg(jsonb_build_object(
                    'test', io.test_name, 'result', io.result_value,
                    'unit', io.result_unit, 'ordered_date', io.ordered_date
                  ))
                  FROM ipd_investigation_orders io
                  WHERE io.admission_id = p_admission_id
                  AND io.is_critical = true
                  AND io.critical_acknowledged_at IS NULL),
    'consultants', (
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', cr.id, 'specialty', cr.specialty,
                    'reason', cr.reason, 'status', cr.status
                  ))
                  FROM ipd_consult_requests cr
                  WHERE cr.admission_id = p_admission_id
                  AND cr.status != 'cancelled')
  )
  INTO v_result
  FROM ipd_admissions a
  WHERE a.id = p_admission_id;
  RETURN v_result;
END;
$$;

-- Fix 4: get_dpn_timeline — also return correct day number
CREATE OR REPLACE FUNCTION get_dpn_timeline(p_admission_id uuid)
RETURNS TABLE (
  note_id           uuid,
  note_date         date,
  hospital_day      integer,
  post_op_day       integer,
  day_label         text,
  condition_status  text,
  subjective_text   text,
  authored_by_name  text,
  status            text,
  signed_at         timestamptz,
  treatment_count   bigint,
  inv_order_count   bigint,
  has_critical_inv  boolean
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    n.id,
    n.note_date,
    GREATEST(1, n.hospital_day_number),
    n.post_op_day,
    n.day_label,
    n.condition_status,
    n.subjective_text,
    p.full_name,
    n.status,
    n.signed_at,
    (SELECT COUNT(*) FROM ipd_treatments t WHERE t.progress_note_id = n.id AND t.status = 'active'),
    (SELECT COUNT(*) FROM ipd_investigation_orders io WHERE io.progress_note_id = n.id),
    (SELECT EXISTS(SELECT 1 FROM ipd_investigation_orders io 
                  WHERE io.progress_note_id = n.id AND io.is_critical = true 
                  AND io.critical_acknowledged_at IS NULL))
  FROM ipd_progress_notes n
  LEFT JOIN practitioners p ON p.id = n.authored_by
  WHERE n.admission_id = p_admission_id
  ORDER BY n.note_date DESC;
$$;

NOTIFY pgrst, 'reload schema';
