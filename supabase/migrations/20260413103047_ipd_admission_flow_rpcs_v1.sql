-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413103047.

-- ================================================================
-- 1. get_ward_census
-- All active admissions for a hospital, grouped by ward
-- Used by nursing staff / ward view (not filtered by doctor)
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_ward_census(p_hospital_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_agg(ward_row ORDER BY ward_name)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'ward_id',   w.id,
      'ward_name', w.name,
      'ward_type', w.ward_type,
      'specialty', w.specialty,
      'total_beds',    COUNT(b.id),
      'occupied_beds', COUNT(b.id) FILTER (WHERE b.status = 'occupied'),
      'available_beds',COUNT(b.id) FILTER (WHERE b.status = 'available'),
      'patients', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'admission_id',      a.id,
          'admission_number',  a.admission_number,
          'admitted_at',       a.admitted_at,
          'admission_type',    a.admission_type,
          'los_days',          EXTRACT(DAY FROM now() - a.admitted_at)::int,
          'expected_discharge_date', a.expected_discharge_date,
          'primary_diagnosis_display', a.primary_diagnosis_display,
          'status',            a.status,
          'bed_number',        b2.bed_number,
          'bed_type',          b2.bed_type,
          'bed_id',            b2.id,
          'patient_id',        p.id,
          'patient_name',      p.full_name,
          'patient_age',       EXTRACT(YEAR FROM age(p.date_of_birth))::int,
          'patient_sex',       p.sex,
          'blood_group',       p.blood_group,
          'known_allergies',   p.known_allergies,
          'doctor_name',       dr.full_name,
          'doctor_id',         dr.id,
          -- Latest vitals
          'latest_bp',         lv.bp_systolic || '/' || lv.bp_diastolic,
          'latest_hr',         lv.heart_rate,
          'latest_temp_c',     lv.temperature_c,
          'latest_spo2',       lv.spo2,
          'latest_pain_score', lv.pain_score,
          'latest_vitals_at',  lv.recorded_at,
          -- Flags
          'pending_consents',  (SELECT COUNT(*) FROM public.ipd_admission_consents
                                WHERE admission_id = a.id AND status = 'pending'),
          'pending_investigations', (SELECT COUNT(*) FROM public.ipd_investigation_orders
                                     WHERE admission_id = a.id AND status IN ('ordered','sent'))
        ) ORDER BY b2.bed_number)
        FROM public.ipd_admissions a
        JOIN public.patients p ON p.id = a.patient_id
        JOIN public.ipd_beds b2 ON b2.id = a.bed_id
        LEFT JOIN public.practitioners dr ON dr.id = a.admitting_doctor_id
        LEFT JOIN LATERAL (
          SELECT bp_systolic, bp_diastolic, heart_rate, temperature_c, spo2, pain_score, recorded_at
          FROM public.ipd_vitals
          WHERE admission_id = a.id
          ORDER BY recorded_at DESC LIMIT 1
        ) lv ON true
        WHERE a.ward_id = w.id AND a.status = 'in-progress'
      ), '[]'::jsonb)
    ) AS ward_row,
    w.name AS ward_name
    FROM public.ipd_wards w
    LEFT JOIN public.ipd_beds b ON b.ward_id = w.id AND b.is_active = TRUE
    WHERE w.hospital_id = p_hospital_id AND w.is_active = TRUE
    GROUP BY w.id, w.name, w.ward_type, w.specialty
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


-- ================================================================
-- 2. transfer_bed
-- Move a patient to a new ward/bed; log in ipd_bed_transfers
-- ================================================================
CREATE OR REPLACE FUNCTION public.transfer_bed(
  p_admission_id  uuid,
  p_to_ward_id    uuid,
  p_to_bed_id     uuid,
  p_reason        text DEFAULT NULL,
  p_transferred_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from_ward_id  uuid;
  v_from_bed_id   uuid;
  v_hospital_id   uuid;
BEGIN
  -- Get current location
  SELECT ward_id, bed_id, hospital_id
  INTO v_from_ward_id, v_from_bed_id, v_hospital_id
  FROM public.ipd_admissions
  WHERE id = p_admission_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admission not found');
  END IF;

  -- Free old bed
  IF v_from_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'available', updated_at = now()
    WHERE id = v_from_bed_id;
  END IF;

  -- Occupy new bed
  UPDATE public.ipd_beds SET status = 'occupied', updated_at = now()
  WHERE id = p_to_bed_id;

  -- Update admission
  UPDATE public.ipd_admissions
  SET ward_id = p_to_ward_id, bed_id = p_to_bed_id, updated_at = now()
  WHERE id = p_admission_id;

  -- Log transfer
  INSERT INTO public.ipd_bed_transfers (
    hospital_id, admission_id,
    from_ward_id, from_bed_id,
    to_ward_id, to_bed_id,
    transferred_at, reason, transferred_by
  ) VALUES (
    v_hospital_id, p_admission_id,
    v_from_ward_id, v_from_bed_id,
    p_to_ward_id, p_to_bed_id,
    now(), p_reason, p_transferred_by
  );

  RETURN jsonb_build_object('success', true, 'admission_id', p_admission_id);
END;
$$;


-- ================================================================
-- 3. discharge_patient
-- Finalizes discharge: updates admission status, frees bed,
-- links discharge summary. Handles AMA and death cases (NABH).
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_patient(
  p_admission_id       uuid,
  p_discharge_type     text DEFAULT 'normal',   -- 'normal'|'ama'|'lama'|'death'|'transfer'|'absconded'
  p_discharge_condition text DEFAULT 'stable',  -- 'stable'|'improved'|'critical'|'expired'
  p_discharged_by      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bed_id     uuid;
  v_hospital_id uuid;
  v_summary_id  uuid;
BEGIN
  SELECT bed_id, hospital_id
  INTO v_bed_id, v_hospital_id
  FROM public.ipd_admissions
  WHERE id = p_admission_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admission not found');
  END IF;

  -- Update admission to finished
  UPDATE public.ipd_admissions SET
    status           = 'finished',
    discharged_at    = now(),
    updated_at       = now()
  WHERE id = p_admission_id;

  -- Free the bed
  IF v_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'available', updated_at = now()
    WHERE id = v_bed_id;
  END IF;

  -- Create or update discharge summary shell
  INSERT INTO public.ipd_discharge_summaries (
    hospital_id, admission_id, patient_id,
    discharge_date, discharge_type, discharge_condition,
    status, prepared_by
  )
  SELECT
    v_hospital_id, p_admission_id, patient_id,
    CURRENT_DATE, p_discharge_type, p_discharge_condition,
    'draft', p_discharged_by
  FROM public.ipd_admissions WHERE id = p_admission_id
  ON CONFLICT (admission_id) DO UPDATE SET
    discharge_type      = EXCLUDED.discharge_type,
    discharge_condition = EXCLUDED.discharge_condition,
    discharge_date      = EXCLUDED.discharge_date,
    updated_at          = now()
  RETURNING id INTO v_summary_id;

  RETURN jsonb_build_object(
    'success',         true,
    'admission_id',    p_admission_id,
    'discharge_summary_id', v_summary_id,
    'discharge_type',  p_discharge_type
  );
END;
$$;


-- ================================================================
-- 4. get_admission_timeline
-- Chronological activity feed for the IPD file view
-- Returns: progress notes, vitals, investigations, consents,
--          consult requests, transfers, wound assessments
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_admission_timeline(p_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result JSONB;
BEGIN
  WITH timeline AS (
    -- Progress notes
    SELECT
      'progress_note' AS event_type,
      id AS event_id,
      created_at AS event_time,
      note_date AS event_date,
      hospital_day_number AS day_number,
      jsonb_build_object(
        'id', id, 'day_label', day_label, 'day_tags', day_tags,
        'status', status, 'is_surgery_day', is_surgery_day,
        'subjective_text', subjective_text, 'assessment_text', assessment_text,
        'plan_text', plan_text, 'condition_status', condition_status,
        'authored_by', authored_by
      ) AS payload
    FROM public.ipd_progress_notes
    WHERE admission_id = p_admission_id

    UNION ALL

    -- Vitals records
    SELECT
      'vitals', id, created_at, recorded_at::date, NULL,
      jsonb_build_object(
        'id', id, 'recorded_at', recorded_at,
        'heart_rate', heart_rate, 'bp_systolic', bp_systolic, 'bp_diastolic', bp_diastolic,
        'temperature_c', temperature_c, 'spo2', spo2, 'pain_score', pain_score,
        'gcs_score', gcs_score, 'recorded_by', recorded_by
      )
    FROM public.ipd_vitals
    WHERE admission_id = p_admission_id

    UNION ALL

    -- Investigation orders
    SELECT
      'investigation', id, created_at, ordered_date, NULL,
      jsonb_build_object(
        'id', id, 'test_name', test_name, 'priority', priority,
        'status', status, 'result_text', result_text,
        'is_critical', is_critical, 'ordered_by', ordered_by
      )
    FROM public.ipd_investigation_orders
    WHERE admission_id = p_admission_id

    UNION ALL

    -- Consult requests
    SELECT
      'consult', id, created_at, requested_at::date, NULL,
      jsonb_build_object(
        'id', id, 'consulting_specialty', consulting_specialty,
        'reason_for_consult', reason_for_consult, 'urgency', urgency,
        'status', status, 'consult_notes', consult_notes
      )
    FROM public.ipd_consult_requests
    WHERE admission_id = p_admission_id

    UNION ALL

    -- Bed transfers
    SELECT
      'transfer', id, created_at, transferred_at::date, NULL,
      jsonb_build_object(
        'id', id, 'reason', reason, 'transferred_at', transferred_at
      )
    FROM public.ipd_bed_transfers
    WHERE admission_id = p_admission_id

    UNION ALL

    -- Wound assessments
    SELECT
      'wound_assessment', id, created_at, assessed_at::date, NULL,
      jsonb_build_object(
        'id', id, 'wound_location', wound_location, 'wound_type', wound_type,
        'suture_status', suture_status, 'drain_present', drain_present,
        'assessed_at', assessed_at, 'assessed_by', assessed_by
      )
    FROM public.ipd_wound_assessments
    WHERE admission_id = p_admission_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'event_type', event_type,
      'event_id',   event_id,
      'event_time', event_time,
      'event_date', event_date,
      'day_number', day_number,
      'payload',    payload
    ) ORDER BY event_time DESC
  )
  INTO v_result
  FROM timeline;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
