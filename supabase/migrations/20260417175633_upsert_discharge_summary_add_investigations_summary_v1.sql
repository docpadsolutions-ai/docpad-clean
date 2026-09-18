-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417175633.

-- Add investigations_summary column to table if missing
ALTER TABLE ipd_discharge_summaries
  ADD COLUMN IF NOT EXISTS investigations_summary text;

-- Recreate function with p_investigations_summary added
CREATE OR REPLACE FUNCTION public.upsert_discharge_summary(
  p_admission_id uuid,
  p_status text DEFAULT 'draft',
  p_discharge_date date DEFAULT NULL,
  p_discharge_type text DEFAULT NULL,
  p_discharge_condition text DEFAULT NULL,
  p_final_diagnosis_icd10 text[] DEFAULT NULL,
  p_final_diagnosis_display text[] DEFAULT NULL,
  p_hospital_course_summary text DEFAULT NULL,
  p_investigations_summary text DEFAULT NULL,
  p_procedures_done text[] DEFAULT NULL,
  p_discharge_medications jsonb DEFAULT NULL,
  p_discharge_instructions text DEFAULT NULL,
  p_follow_up_date date DEFAULT NULL,
  p_diet_advice text DEFAULT NULL,
  p_activity_restrictions text DEFAULT NULL,
  p_wound_care_instructions text DEFAULT NULL,
  p_implant_details jsonb DEFAULT NULL,
  p_post_op_protocol text DEFAULT NULL,
  p_physiotherapy_plan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id UUID;
  v_patient_id UUID;
  v_existing_id UUID;
  v_existing_status TEXT;
  v_result_id UUID;
  v_signed_at TIMESTAMPTZ;
  v_signed_by UUID;
BEGIN
  SELECT hospital_id, patient_id INTO v_hospital_id, v_patient_id
  FROM ipd_admissions WHERE id = p_admission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;

  SELECT id, status INTO v_existing_id, v_existing_status
  FROM ipd_discharge_summaries
  WHERE admission_id = p_admission_id
  LIMIT 1;

  IF v_existing_status = 'finalized' THEN
    RAISE EXCEPTION 'Discharge summary is finalized and locked';
  END IF;

  IF p_status = 'finalized' THEN
    v_signed_at := NOW();
    v_signed_by := auth.uid();
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE ipd_discharge_summaries SET
      status                   = p_status,
      discharge_date           = COALESCE(p_discharge_date, discharge_date),
      discharge_type           = COALESCE(p_discharge_type, discharge_type),
      discharge_condition      = COALESCE(p_discharge_condition, discharge_condition),
      final_diagnosis_icd10    = COALESCE(p_final_diagnosis_icd10, final_diagnosis_icd10),
      final_diagnosis_display  = COALESCE(p_final_diagnosis_display, final_diagnosis_display),
      hospital_course_summary  = COALESCE(p_hospital_course_summary, hospital_course_summary),
      investigations_summary   = COALESCE(p_investigations_summary, investigations_summary),
      procedures_done          = COALESCE(p_procedures_done, procedures_done),
      discharge_medications    = COALESCE(p_discharge_medications, discharge_medications),
      discharge_instructions   = COALESCE(p_discharge_instructions, discharge_instructions),
      follow_up_date           = COALESCE(p_follow_up_date, follow_up_date),
      diet_advice              = COALESCE(p_diet_advice, diet_advice),
      activity_restrictions    = COALESCE(p_activity_restrictions, activity_restrictions),
      wound_care_instructions  = COALESCE(p_wound_care_instructions, wound_care_instructions),
      implant_details          = COALESCE(p_implant_details, implant_details),
      post_op_protocol         = COALESCE(p_post_op_protocol, post_op_protocol),
      physiotherapy_plan       = COALESCE(p_physiotherapy_plan, physiotherapy_plan),
      signed_by                = COALESCE(v_signed_by, signed_by),
      signed_at                = COALESCE(v_signed_at, signed_at),
      updated_at               = NOW()
    WHERE id = v_existing_id
    RETURNING id INTO v_result_id;
  ELSE
    INSERT INTO ipd_discharge_summaries (
      hospital_id, admission_id, patient_id, status,
      discharge_date, discharge_type, discharge_condition,
      final_diagnosis_icd10, final_diagnosis_display,
      hospital_course_summary, investigations_summary,
      procedures_done, discharge_medications, discharge_instructions,
      follow_up_date, diet_advice, activity_restrictions,
      wound_care_instructions, implant_details,
      post_op_protocol, physiotherapy_plan,
      prepared_by, signed_by, signed_at
    ) VALUES (
      v_hospital_id, p_admission_id, v_patient_id, p_status,
      p_discharge_date, p_discharge_type, p_discharge_condition,
      p_final_diagnosis_icd10, p_final_diagnosis_display,
      p_hospital_course_summary, p_investigations_summary,
      p_procedures_done, p_discharge_medications, p_discharge_instructions,
      p_follow_up_date, p_diet_advice, p_activity_restrictions,
      p_wound_care_instructions, p_implant_details,
      p_post_op_protocol, p_physiotherapy_plan,
      auth.uid(), v_signed_by, v_signed_at
    )
    RETURNING id INTO v_result_id;
  END IF;

  IF p_status = 'finalized' THEN
    UPDATE ipd_admissions SET
      status        = 'discharged',
      discharged_at = NOW(),
      updated_at    = NOW()
    WHERE id = p_admission_id;
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'success', TRUE,
    'discharge_summary_id', v_result_id,
    'status', p_status
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
