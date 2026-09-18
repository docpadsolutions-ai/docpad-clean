-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411081233.

CREATE OR REPLACE FUNCTION public.admit_patient(
  p_hospital_id uuid,
  p_patient_id uuid,
  p_source_opd_encounter_id uuid DEFAULT NULL,
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
AS $function$
DECLARE
  v_admission_id  UUID;
  v_adm_number    TEXT;
  v_consent_type  RECORD;
  v_note_id       UUID;
BEGIN
  v_adm_number := 'IPD-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(NEXTVAL('ipd_admission_number_seq')::TEXT, 6, '0');

  INSERT INTO public.ipd_admissions (
    hospital_id, patient_id, source_opd_encounter_id,
    admitting_doctor_id, admitting_department_id,
    ward_id, bed_id, admission_type,
    primary_diagnosis_icd10, primary_diagnosis_display,
    admission_number, status, admitted_at, admitted_by,
    pre_admission_assessment_id
  ) VALUES (
    p_hospital_id, p_patient_id, p_source_opd_encounter_id,
    p_admitting_doctor_id, p_admitting_department_id,
    p_ward_id, p_bed_id, p_admission_type,
    p_primary_diagnosis_icd10, p_primary_diagnosis_display,
    v_adm_number, 'in-progress', NOW(),
    p_admitting_doctor_id,
    p_pre_admission_assessment_id
  ) RETURNING id INTO v_admission_id;

  IF p_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'occupied' WHERE id = p_bed_id;
  END IF;

  FOR v_consent_type IN
    SELECT id FROM public.ipd_consent_types WHERE is_mandatory = TRUE AND is_active = TRUE
  LOOP
    INSERT INTO public.ipd_admission_consents (
      hospital_id, admission_id, patient_id, consent_type_id, status
    ) VALUES (
      p_hospital_id, v_admission_id, p_patient_id, v_consent_type.id, 'pending'
    ) ON CONFLICT (admission_id, consent_type_id) DO NOTHING;
  END LOOP;

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
$function$;
