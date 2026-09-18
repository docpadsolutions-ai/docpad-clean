-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411101635.

-- ============================================================
-- RPC 1: get_dpn_timeline
-- Returns all progress notes for an admission as day-list
-- ============================================================
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
    n.hospital_day_number,
    n.post_op_day,
    n.day_label,
    n.condition_status,
    n.subjective_text,
    p.full_name,
    n.status,
    n.signed_at,
    (SELECT COUNT(*) FROM ipd_treatments t WHERE t.progress_note_id = n.id AND t.status = 'active'),
    (SELECT COUNT(*) FROM ipd_investigation_orders io WHERE io.progress_note_id = n.id),
    (SELECT EXISTS(SELECT 1 FROM ipd_investigation_orders io WHERE io.progress_note_id = n.id AND io.is_critical = true AND io.critical_acknowledged_at IS NULL))
  FROM ipd_progress_notes n
  LEFT JOIN practitioners p ON p.id = n.authored_by
  WHERE n.admission_id = p_admission_id
  ORDER BY n.note_date DESC;
$$;

-- ============================================================
-- RPC 2: get_dpn_full_note
-- Returns full DPN data for one progress note (centre panel)
-- ============================================================
CREATE OR REPLACE FUNCTION get_dpn_full_note(p_note_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'note',        row_to_json(n.*),
    'vitals',      (SELECT jsonb_agg(row_to_json(v.*) ORDER BY v.recorded_at DESC)
                   FROM ipd_vitals v WHERE v.progress_note_id = n.id),
    'wound',       (SELECT row_to_json(w.*) FROM ipd_wound_assessments w
                   WHERE w.progress_note_id = n.id ORDER BY w.assessed_at DESC LIMIT 1),
    'io',          (SELECT row_to_json(io.*) FROM ipd_io_records io
                   WHERE io.progress_note_id = n.id LIMIT 1),
    'treatments',  (
                   SELECT jsonb_agg(
                     jsonb_build_object(
                       'treatment', row_to_json(t.*),
                       'nar_today', (
                         SELECT jsonb_agg(row_to_json(nar.*) ORDER BY nar.scheduled_at)
                         FROM ipd_nar_records nar
                         WHERE nar.treatment_id = t.id
                         AND nar.scheduled_at::date = n.note_date
                       )
                     )
                   )
                   FROM ipd_treatments t WHERE t.progress_note_id = n.id
                   ),
    'investigations', (
                   SELECT jsonb_agg(row_to_json(io.*) ORDER BY io.ordered_date DESC)
                   FROM ipd_investigation_orders io WHERE io.progress_note_id = n.id
                   ),
    'nabh',        (SELECT row_to_json(nc.*) FROM ipd_nabh_checklist nc
                   WHERE nc.progress_note_id = n.id LIMIT 1),
    'author',      (SELECT full_name FROM practitioners p WHERE p.id = n.authored_by)
  )
  INTO v_result
  FROM ipd_progress_notes n
  WHERE n.id = p_note_id;
  RETURN v_result;
END;
$$;

-- ============================================================
-- RPC 3: get_dpn_right_panel
-- Admission summary + alerts + pending + condition trend
-- ============================================================
CREATE OR REPLACE FUNCTION get_dpn_right_panel(p_admission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'admission',  row_to_json(a.*),
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
                  FROM ipd_condition_timeline ct WHERE ct.admission_id = p_admission_id
                  ),
    'pending_investigations', (
                  SELECT jsonb_agg(row_to_json(io.*))
                  FROM ipd_investigation_orders io
                  WHERE io.admission_id = p_admission_id
                  AND io.status NOT IN ('reported','cancelled')
                  ORDER BY io.ordered_date DESC
                  ),
    'critical_alerts', (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'test', io.test_name, 'result', io.result_value,
                      'unit', io.result_unit, 'ordered_date', io.ordered_date
                    )
                  )
                  FROM ipd_investigation_orders io
                  WHERE io.admission_id = p_admission_id
                  AND io.is_critical = true
                  AND io.critical_acknowledged_at IS NULL
                  ),
    'consultants', (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', cr.id, 'specialty', cr.specialty,
                      'reason', cr.reason, 'status', cr.status
                    )
                  )
                  FROM ipd_consult_requests cr
                  WHERE cr.admission_id = p_admission_id
                  AND cr.status != 'cancelled'
                  )
  )
  INTO v_result
  FROM ipd_admissions a
  WHERE a.id = p_admission_id;
  RETURN v_result;
END;
$$;

-- ============================================================
-- RPC 4: upsert_dpn_note
-- Create or update a progress note + upsert condition timeline
-- ============================================================
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
  -- Calculate days
  SELECT admitted_at::date, surgery_date
  INTO v_admitted_at, v_surgery_date
  FROM ipd_admissions WHERE id = p_admission_id;

  v_hospital_day := (p_note_date - v_admitted_at) + 1;
  v_post_op_day  := CASE WHEN v_surgery_date IS NOT NULL
                    THEN (p_note_date - v_surgery_date) + 1
                    ELSE NULL END;

  IF p_note_id IS NOT NULL THEN
    -- Update existing note
    UPDATE ipd_progress_notes SET
      subjective_text      = COALESCE(p_subjective_text, subjective_text),
      appetite             = COALESCE(p_appetite, appetite),
      sleep_ok             = COALESCE(p_sleep_ok, sleep_ok),
      bowel_ok             = COALESCE(p_bowel_ok, bowel_ok),
      bladder_ok           = COALESCE(p_bladder_ok, bladder_ok),
      objective_text       = COALESCE(p_objective_text, objective_text),
      assessment_text      = COALESCE(p_assessment_text, assessment_text),
      plan_text            = COALESCE(p_plan_text, plan_text),
      plan_narrative       = COALESCE(p_plan_narrative, plan_narrative),
      condition_status     = COALESCE(p_condition_status, condition_status),
      medical_surgical_notes = COALESCE(p_medical_surgical_notes, medical_surgical_notes),
      updated_at           = now()
    WHERE id = p_note_id AND status = 'draft'
    RETURNING id INTO v_note_id;
  ELSE
    -- Insert new note (one per admission per date)
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

  -- Upsert condition timeline
  IF p_condition_status IS NOT NULL AND v_note_id IS NOT NULL THEN
    INSERT INTO ipd_condition_timeline (
      hospital_id, admission_id, patient_id, progress_note_id,
      recorded_date, hospital_day, condition_status, recorded_by
    ) VALUES (
      p_hospital_id, p_admission_id, p_patient_id, v_note_id,
      p_note_date, v_hospital_day, p_condition_status, p_authored_by
    )
    ON CONFLICT (admission_id, recorded_date)
    DO UPDATE SET condition_status = EXCLUDED.condition_status, recorded_by = EXCLUDED.recorded_by;
  END IF;

  RETURN v_note_id;
END;
$$;

-- ============================================================
-- RPC 5: sign_dpn_note — locks the note (NMC 2023 compliance)
-- ============================================================
CREATE OR REPLACE FUNCTION sign_dpn_note(
  p_note_id     uuid,
  p_signed_by   uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ipd_progress_notes SET
    status    = 'signed',
    signed_at = now(),
    authored_by = COALESCE(authored_by, p_signed_by)
  WHERE id = p_note_id AND status = 'draft';
  RETURN FOUND;
END;
$$;

-- ============================================================
-- RPC 6: order_investigation
-- Adds an investigation order anchored to a progress note/day
-- ============================================================
CREATE OR REPLACE FUNCTION order_dpn_investigation(
  p_admission_id   uuid,
  p_hospital_id    uuid,
  p_patient_id     uuid,
  p_note_id        uuid,
  p_test_name      text,
  p_test_category  text DEFAULT 'lab',
  p_priority       text DEFAULT 'routine',
  p_loinc_code     text DEFAULT NULL,
  p_ordered_by     uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_day     integer;
  v_id      uuid;
BEGIN
  SELECT hospital_day_number INTO v_day
  FROM ipd_progress_notes WHERE id = p_note_id;

  INSERT INTO ipd_investigation_orders (
    hospital_id, admission_id, patient_id, progress_note_id,
    ordered_on_day, ordered_date, ordered_by,
    test_name, test_category, loinc_code, priority, status
  ) VALUES (
    p_hospital_id, p_admission_id, p_patient_id, p_note_id,
    v_day, CURRENT_DATE, p_ordered_by,
    p_test_name, p_test_category, p_loinc_code, p_priority, 'ordered'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
