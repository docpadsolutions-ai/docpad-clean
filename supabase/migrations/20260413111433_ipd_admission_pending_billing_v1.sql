-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413111433.

-- Add 'held' bed status for pending billing
-- Add 'confirm_admission' RPC to finalize after payment

-- Update admit_patient to create admission as 'pending_billing'
-- and mark bed as 'held' instead of 'occupied'
CREATE OR REPLACE FUNCTION public.admit_patient(
  p_hospital_id uuid,
  p_patient_id uuid,
  p_opd_encounter_id uuid DEFAULT NULL,
  p_admitting_doctor_id uuid DEFAULT NULL,
  p_admitting_department_id uuid DEFAULT NULL,
  p_ward_id uuid DEFAULT NULL,
  p_bed_id uuid DEFAULT NULL,
  p_admission_type text DEFAULT 'elective',
  p_primary_diagnosis_icd10 text DEFAULT NULL,
  p_primary_diagnosis_display text DEFAULT NULL,
  p_pre_admission_assessment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admission_id  UUID;
  v_adm_number    TEXT;
  v_consent_type  RECORD;
  v_note_id       UUID;
BEGIN
  v_adm_number := 'IPD-' || TO_CHAR(NOW(), 'YYYY') || '-' || 
                  LPAD(NEXTVAL('ipd_admission_number_seq')::TEXT, 6, '0');

  INSERT INTO public.ipd_admissions (
    hospital_id, patient_id, source_opd_encounter_id,
    admitting_doctor_id, admitting_department_id,
    ward_id, bed_id, admission_type,
    primary_diagnosis_icd10, primary_diagnosis_display,
    admission_number, status, admitted_at, admitted_by,
    pre_admission_assessment_id
  ) VALUES (
    p_hospital_id, p_patient_id, p_opd_encounter_id,
    p_admitting_doctor_id, p_admitting_department_id,
    p_ward_id, p_bed_id, p_admission_type,
    p_primary_diagnosis_icd10, p_primary_diagnosis_display,
    v_adm_number, 'pending_billing', NOW(),
    p_admitting_doctor_id,
    p_pre_admission_assessment_id
  ) RETURNING id INTO v_admission_id;

  -- Mark bed as 'held' (reserved but not yet active)
  IF p_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'held', updated_at = now()
    WHERE id = p_bed_id;
  END IF;

  -- Auto-populate mandatory consent rows
  FOR v_consent_type IN
    SELECT id FROM public.ipd_consent_types 
    WHERE is_mandatory = TRUE AND is_active = TRUE
  LOOP
    INSERT INTO public.ipd_admission_consents (
      hospital_id, admission_id, patient_id, consent_type_id, status
    ) VALUES (
      p_hospital_id, v_admission_id, p_patient_id, v_consent_type.id, 'pending'
    ) ON CONFLICT (admission_id, consent_type_id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'admission_id',     v_admission_id,
    'admission_number', v_adm_number,
    'status',           'pending_billing'
  );
END;
$$;


-- ================================================================
-- confirm_admission: Called by reception after payment collected
-- Activates the admission, allocates bed, creates Day 0 note
-- ================================================================
CREATE OR REPLACE FUNCTION public.confirm_admission(
  p_admission_id   uuid,
  p_confirmed_by   uuid DEFAULT NULL,
  p_invoice_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bed_id      uuid;
  v_hospital_id uuid;
  v_patient_id  uuid;
  v_doctor_id   uuid;
  v_note_id     uuid;
BEGIN
  SELECT bed_id, hospital_id, patient_id, admitting_doctor_id
  INTO v_bed_id, v_hospital_id, v_patient_id, v_doctor_id
  FROM public.ipd_admissions
  WHERE id = p_admission_id AND status = 'pending_billing';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 
      'error', 'Admission not found or already confirmed');
  END IF;

  -- Activate admission
  UPDATE public.ipd_admissions SET
    status     = 'in-progress',
    updated_at = now()
  WHERE id = p_admission_id;

  -- Mark bed as occupied
  IF v_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'occupied', updated_at = now()
    WHERE id = v_bed_id;
  END IF;

  -- Create Day 0 progress note (admission day)
  INSERT INTO public.ipd_progress_notes (
    hospital_id, admission_id, patient_id,
    note_date, hospital_day_number, day_label,
    day_tags, authored_by, status
  ) VALUES (
    v_hospital_id, p_admission_id, v_patient_id,
    CURRENT_DATE, 0, 'Day 0 – Admission',
    ARRAY['Admission'], v_doctor_id, 'draft'
  ) RETURNING id INTO v_note_id;

  RETURN jsonb_build_object(
    'success',          true,
    'admission_id',     p_admission_id,
    'progress_note_id', v_note_id
  );
END;
$$;


-- ================================================================
-- get_pending_admissions: Reception queue of unconfirmed admissions
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_pending_admissions(p_hospital_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'admission_id',      a.id,
    'admission_number',  a.admission_number,
    'admission_type',    a.admission_type,
    'admitted_at',       a.admitted_at,
    'primary_diagnosis', a.primary_diagnosis_display,
    'patient_id',        p.id,
    'patient_name',      p.full_name,
    'patient_age',       EXTRACT(YEAR FROM age(p.date_of_birth))::int,
    'patient_sex',       p.sex,
    'patient_phone',     p.phone,
    'ward_name',         w.name,
    'bed_number',        b.bed_number,
    'bed_type',          b.bed_type,
    'doctor_name',       dr.full_name,
    'doctor_specialty',  dr.specialty
  ) ORDER BY a.admitted_at DESC)
  INTO v_result
  FROM public.ipd_admissions a
  JOIN public.patients p ON p.id = a.patient_id
  LEFT JOIN public.ipd_wards w ON w.id = a.ward_id
  LEFT JOIN public.ipd_beds b ON b.id = a.bed_id
  LEFT JOIN public.practitioners dr ON dr.id = a.admitting_doctor_id
  WHERE a.hospital_id = p_hospital_id
    AND a.status = 'pending_billing';

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
