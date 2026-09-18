-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411072135.

-- ============================================================
-- IPD RPCs
-- ============================================================

-- 1. Admit patient: create admission + auto-populate consent rows + first progress note
DROP FUNCTION IF EXISTS admit_patient(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION admit_patient(
  p_hospital_id               UUID,
  p_patient_id                UUID,
  p_source_opd_encounter_id   UUID DEFAULT NULL,
  p_admitting_doctor_id       UUID DEFAULT NULL,
  p_admitting_department_id   UUID DEFAULT NULL,
  p_ward_id                   UUID DEFAULT NULL,
  p_bed_id                    UUID DEFAULT NULL,
  p_admission_type            TEXT DEFAULT 'elective',
  p_primary_diagnosis_icd10   TEXT DEFAULT NULL,
  p_primary_diagnosis_display TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admission_id  UUID;
  v_adm_number    TEXT;
  v_consent_type  RECORD;
  v_note_id       UUID;
BEGIN
  -- Generate admission number
  v_adm_number := 'IPD-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(NEXTVAL('ipd_admission_number_seq')::TEXT, 6, '0');

  -- Create admission
  INSERT INTO public.ipd_admissions (
    hospital_id, patient_id, source_opd_encounter_id,
    admitting_doctor_id, admitting_department_id,
    ward_id, bed_id, admission_type,
    primary_diagnosis_icd10, primary_diagnosis_display,
    admission_number, status, admitted_at,
    admitted_by
  ) VALUES (
    p_hospital_id, p_patient_id, p_source_opd_encounter_id,
    p_admitting_doctor_id, p_admitting_department_id,
    p_ward_id, p_bed_id, p_admission_type,
    p_primary_diagnosis_icd10, p_primary_diagnosis_display,
    v_adm_number, 'in-progress', NOW(),
    p_admitting_doctor_id
  ) RETURNING id INTO v_admission_id;

  -- Mark bed as occupied
  IF p_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'occupied' WHERE id = p_bed_id;
  END IF;

  -- Auto-populate all mandatory consent rows
  FOR v_consent_type IN
    SELECT id FROM public.ipd_consent_types WHERE is_mandatory = TRUE AND is_active = TRUE
  LOOP
    INSERT INTO public.ipd_admission_consents (
      hospital_id, admission_id, patient_id, consent_type_id, status
    ) VALUES (
      p_hospital_id, v_admission_id, p_patient_id, v_consent_type.id, 'pending'
    ) ON CONFLICT (admission_id, consent_type_id) DO NOTHING;
  END LOOP;

  -- Create Day 0 progress note (admission day)
  INSERT INTO public.ipd_progress_notes (
    hospital_id, admission_id, patient_id,
    note_date, hospital_day_number, day_label,
    day_tags, authored_by, status
  ) VALUES (
    p_hospital_id, v_admission_id, p_patient_id,
    CURRENT_DATE, 0, 'Day 0 – Admission',
    ARRAY['Admission'], p_admitting_doctor_id, 'draft'
  ) RETURNING id INTO v_note_id;

  RETURN jsonb_build_object(
    'admission_id', v_admission_id,
    'admission_number', v_adm_number,
    'progress_note_id', v_note_id
  );
END;
$$;

-- 2. Get admission with full context
DROP FUNCTION IF EXISTS get_ipd_admission(UUID);

CREATE OR REPLACE FUNCTION get_ipd_admission(p_admission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'admission',  row_to_json(a),
    'patient',    jsonb_build_object(
                    'id', p.id, 'full_name', p.full_name, 'date_of_birth', p.date_of_birth,
                    'sex', p.sex, 'docpad_id', p.docpad_id, 'blood_group', p.blood_group,
                    'known_allergies', p.known_allergies, 'abha_number', p.abha_number
                  ),
    'ward',       jsonb_build_object('id', w.id, 'name', w.name, 'ward_type', w.ward_type),
    'bed',        jsonb_build_object('id', b.id, 'bed_number', b.bed_number, 'bed_type', b.bed_type),
    'doctor',     jsonb_build_object('id', dr.id, 'full_name', dr.full_name, 'specialty', dr.specialty),
    'consents',   (SELECT jsonb_agg(jsonb_build_object(
                    'id', c.id, 'type_code', ct.code, 'type_name', ct.display_name,
                    'status', c.status, 'is_mandatory', ct.is_mandatory,
                    'otp_verified', c.otp_verified, 'signed_at', c.signed_at
                  ))
                  FROM public.ipd_admission_consents c
                  JOIN public.ipd_consent_types ct ON ct.id = c.consent_type_id
                  WHERE c.admission_id = a.id),
    'progress_notes', (SELECT jsonb_agg(jsonb_build_object(
                    'id', n.id, 'note_date', n.note_date, 'day_label', n.day_label,
                    'day_tags', n.day_tags, 'status', n.status,
                    'is_surgery_day', n.is_surgery_day,
                    'hospital_day_number', n.hospital_day_number
                  ) ORDER BY n.note_date)
                  FROM public.ipd_progress_notes n WHERE n.admission_id = a.id)
  ) INTO v_result
  FROM public.ipd_admissions a
  LEFT JOIN public.patients p ON p.id = a.patient_id
  LEFT JOIN public.ipd_wards w ON w.id = a.ward_id
  LEFT JOIN public.ipd_beds b ON b.id = a.bed_id
  LEFT JOIN public.practitioners dr ON dr.id = a.admitting_doctor_id
  WHERE a.id = p_admission_id;

  RETURN v_result;
END;
$$;

-- 3. Update consent status (OTP mock verification)
DROP FUNCTION IF EXISTS update_consent_status(UUID, TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION update_consent_status(
  p_consent_id        UUID,
  p_status            TEXT DEFAULT NULL,
  p_signed_by_name    TEXT DEFAULT NULL,
  p_signed_by_relation TEXT DEFAULT NULL,
  p_otp_verified      BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row public.ipd_admission_consents;
BEGIN
  UPDATE public.ipd_admission_consents SET
    status             = COALESCE(p_status, status),
    signed_by_name     = COALESCE(p_signed_by_name, signed_by_name),
    signed_by_relation = COALESCE(p_signed_by_relation, signed_by_relation),
    otp_verified       = COALESCE(p_otp_verified, otp_verified),
    otp_verified_at    = CASE WHEN p_otp_verified = TRUE THEN NOW() ELSE otp_verified_at END,
    signed_at          = CASE WHEN p_status = 'obtained' AND signed_at IS NULL THEN NOW() ELSE signed_at END,
    verification_mode  = 'mock'
  WHERE id = p_consent_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row)::JSONB;
END;
$$;

-- 4. Get or create today's progress note for an admission
DROP FUNCTION IF EXISTS get_or_create_progress_note(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION get_or_create_progress_note(
  p_admission_id      UUID,
  p_hospital_id       UUID,
  p_authored_by       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_note_id   UUID;
  v_day_num   INTEGER;
  v_label     TEXT;
  v_admitted  TIMESTAMPTZ;
BEGIN
  -- Get admitted_at
  SELECT admitted_at INTO v_admitted FROM public.ipd_admissions WHERE id = p_admission_id;
  v_day_num := (CURRENT_DATE - v_admitted::DATE);
  v_label := CASE WHEN v_day_num = 0 THEN 'Day 0 – Admission'
                  WHEN v_day_num < 0 THEN 'Pre-op – Day ' || v_day_num
                  ELSE 'POD ' || v_day_num
             END;

  -- Upsert today's note
  INSERT INTO public.ipd_progress_notes (
    hospital_id, admission_id, patient_id,
    note_date, hospital_day_number, day_label, authored_by, status
  )
  SELECT p_hospital_id, p_admission_id, patient_id, CURRENT_DATE, v_day_num, v_label, p_authored_by, 'draft'
  FROM public.ipd_admissions WHERE id = p_admission_id
  ON CONFLICT (admission_id, note_date) DO NOTHING
  RETURNING id INTO v_note_id;

  -- If already existed
  IF v_note_id IS NULL THEN
    SELECT id INTO v_note_id FROM public.ipd_progress_notes
    WHERE admission_id = p_admission_id AND note_date = CURRENT_DATE;
  END IF;

  RETURN (SELECT row_to_json(n)::JSONB FROM public.ipd_progress_notes n WHERE id = v_note_id);
END;
$$;

-- 5. Get bed availability for a hospital
DROP FUNCTION IF EXISTS get_bed_availability(UUID);

CREATE OR REPLACE FUNCTION get_bed_availability(p_hospital_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'ward_id', w.id,
    'ward_name', w.name,
    'ward_type', w.ward_type,
    'specialty', w.specialty,
    'total_beds', COUNT(b.id),
    'available', COUNT(b.id) FILTER (WHERE b.status = 'available'),
    'occupied', COUNT(b.id) FILTER (WHERE b.status = 'occupied'),
    'beds', jsonb_agg(jsonb_build_object(
      'id', b.id, 'bed_number', b.bed_number,
      'status', b.status, 'bed_type', b.bed_type
    ) ORDER BY b.bed_number)
  ))
  INTO v_result
  FROM public.ipd_wards w
  LEFT JOIN public.ipd_beds b ON b.ward_id = w.id AND b.is_active = TRUE
  WHERE w.hospital_id = p_hospital_id AND w.is_active = TRUE
  GROUP BY w.id, w.name, w.ward_type, w.specialty;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';
