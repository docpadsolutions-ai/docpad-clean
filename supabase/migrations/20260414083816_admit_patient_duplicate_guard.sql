-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414083816.

DROP FUNCTION IF EXISTS public.admit_patient(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid);

CREATE FUNCTION public.admit_patient(
  p_hospital_id                UUID,
  p_patient_id                 UUID,
  p_opd_encounter_id           UUID,
  p_admitting_doctor_id        UUID,
  p_admitting_department_id    UUID,
  p_ward_id                    UUID,
  p_bed_id                     UUID,
  p_admission_type             TEXT,
  p_primary_diagnosis_icd10    TEXT,
  p_primary_diagnosis_display  TEXT,
  p_pre_admission_assessment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admission_id  UUID;
  v_adm_number    TEXT;
  v_consent_type  RECORD;
  v_existing_id   UUID;
BEGIN
  -- Guard: prevent duplicate active admission for the same OPD encounter
  SELECT id INTO v_existing_id
  FROM public.ipd_admissions
  WHERE source_opd_encounter_id = p_opd_encounter_id
    AND status NOT IN ('discharged', 'cancelled')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'error', 'duplicate_active_admission',
      'message', 'This encounter already has an active admission.',
      'existing_admission_id', v_existing_id
    );
  END IF;

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

  IF p_bed_id IS NOT NULL THEN
    UPDATE public.ipd_beds SET status = 'held', updated_at = now()
    WHERE id = p_bed_id;
  END IF;

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
