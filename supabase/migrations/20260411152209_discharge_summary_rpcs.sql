-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411152209.

-- ============================================================
-- RPC 1: compile_discharge_summary
-- Read-only. Pulls all IPD data for the discharge preview.
-- ============================================================
DROP FUNCTION IF EXISTS compile_discharge_summary(UUID);
CREATE OR REPLACE FUNCTION compile_discharge_summary(p_admission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admission RECORD;
  v_patient RECORD;
  v_progress_notes JSONB;
  v_investigations JSONB;
  v_treatments JSONB;
  v_surgery RECORD;
  v_existing_draft RECORD;
  v_doctor_name TEXT;
BEGIN
  SELECT
    a.*,
    d.name AS department_name,
    w.name AS ward_name
  INTO v_admission
  FROM ipd_admissions a
  LEFT JOIN departments d ON d.id = a.admitting_department_id
  LEFT JOIN ipd_wards w ON w.id = a.ward_id
  WHERE a.id = p_admission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admission not found: %', p_admission_id;
  END IF;

  SELECT full_name INTO v_doctor_name
  FROM practitioners WHERE id = v_admission.admitting_doctor_id LIMIT 1;

  SELECT
    pt.id, pt.full_name, pt.date_of_birth, pt.gender, pt.uhid,
    pt.phone, pt.address,
    EXTRACT(YEAR FROM AGE(pt.date_of_birth))::INT AS age
  INTO v_patient
  FROM patients pt
  WHERE pt.id = v_admission.patient_id;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', pn.id,
      'note_date', pn.note_date,
      'subjective', pn.subjective,
      'objective', pn.objective,
      'assessment', pn.assessment,
      'plan', pn.plan,
      'vitals', pn.vitals,
      'wound_notes', pn.wound_notes,
      'medications', pn.medications
    ) ORDER BY pn.note_date
  )
  INTO v_progress_notes
  FROM ipd_progress_notes pn
  WHERE pn.admission_id = p_admission_id;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', io.id,
      'ordered_date', io.ordered_date,
      'test_name', io.test_name,
      'test_category', io.test_category,
      'result_value', io.result_value,
      'result_unit', io.result_unit,
      'result_flag', io.result_flag,
      'status', io.status,
      'reported_at', io.reported_at
    ) ORDER BY io.ordered_date, io.test_name
  )
  INTO v_investigations
  FROM ipd_investigation_orders io
  WHERE io.admission_id = p_admission_id;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'drug_name', t.drug_name,
      'dose', t.dose,
      'route', t.route,
      'frequency', t.frequency,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'status', t.status
    ) ORDER BY t.start_date
  )
  INTO v_treatments
  FROM ipd_treatments t
  WHERE t.admission_id = p_admission_id;

  SELECT
    os.id, os.surgery_name, os.surgery_date, os.anaesthesia_type,
    os.surgeon_name, os.procedure_notes, os.implants_used,
    os.duration_minutes, os.status
  INTO v_surgery
  FROM ot_surgeries os
  WHERE os.admission_id = p_admission_id
  ORDER BY os.surgery_date DESC
  LIMIT 1;

  SELECT * INTO v_existing_draft
  FROM ipd_discharge_summaries
  WHERE admission_id = p_admission_id
  LIMIT 1;

  RETURN JSONB_BUILD_OBJECT(
    'patient', JSONB_BUILD_OBJECT(
      'id', v_patient.id,
      'name', v_patient.full_name,
      'uhid', v_patient.uhid,
      'age', v_patient.age,
      'gender', v_patient.gender,
      'phone', v_patient.phone,
      'address', v_patient.address,
      'dob', v_patient.date_of_birth
    ),
    'admission', JSONB_BUILD_OBJECT(
      'id', v_admission.id,
      'admission_number', v_admission.admission_number,
      'admitted_at', v_admission.admitted_at,
      'expected_discharge_date', v_admission.expected_discharge_date,
      'admission_type', v_admission.admission_type,
      'admission_class', v_admission.admission_class,
      'specialty', v_admission.specialty,
      'department', v_admission.department_name,
      'ward', v_admission.ward_name,
      'admitting_doctor', v_doctor_name,
      'primary_diagnosis_icd10', v_admission.primary_diagnosis_icd10,
      'primary_diagnosis_display', v_admission.primary_diagnosis_display
    ),
    'progress_notes', COALESCE(v_progress_notes, '[]'::JSONB),
    'investigations', COALESCE(v_investigations, '[]'::JSONB),
    'treatments', COALESCE(v_treatments, '[]'::JSONB),
    'surgery', CASE WHEN v_surgery.id IS NOT NULL THEN
      JSONB_BUILD_OBJECT(
        'id', v_surgery.id,
        'name', v_surgery.surgery_name,
        'date', v_surgery.surgery_date,
        'anaesthesia', v_surgery.anaesthesia_type,
        'surgeon', v_surgery.surgeon_name,
        'notes', v_surgery.procedure_notes,
        'implants', v_surgery.implants_used,
        'duration_minutes', v_surgery.duration_minutes
      )
    ELSE NULL END,
    'draft', CASE WHEN v_existing_draft.id IS NOT NULL THEN
      JSONB_BUILD_OBJECT(
        'id', v_existing_draft.id,
        'status', v_existing_draft.status,
        'discharge_condition', v_existing_draft.discharge_condition,
        'discharge_type', v_existing_draft.discharge_type,
        'discharge_date', v_existing_draft.discharge_date,
        'hospital_course_summary', v_existing_draft.hospital_course_summary,
        'discharge_medications', v_existing_draft.discharge_medications,
        'discharge_instructions', v_existing_draft.discharge_instructions,
        'follow_up_date', v_existing_draft.follow_up_date,
        'diet_advice', v_existing_draft.diet_advice,
        'activity_restrictions', v_existing_draft.activity_restrictions,
        'wound_care_instructions', v_existing_draft.wound_care_instructions,
        'implant_details', v_existing_draft.implant_details,
        'post_op_protocol', v_existing_draft.post_op_protocol,
        'physiotherapy_plan', v_existing_draft.physiotherapy_plan
      )
    ELSE NULL END
  );
END;
$$;

-- ============================================================
-- RPC 2: upsert_discharge_summary
-- Saves draft or finalizes. Guards against editing locked records.
-- ============================================================
DROP FUNCTION IF EXISTS upsert_discharge_summary(UUID,TEXT,DATE,TEXT,TEXT,TEXT[],TEXT[],TEXT,TEXT[],JSONB,TEXT,DATE,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT);
CREATE OR REPLACE FUNCTION upsert_discharge_summary(
  p_admission_id UUID,
  p_status TEXT DEFAULT 'draft',
  p_discharge_date DATE DEFAULT NULL,
  p_discharge_type TEXT DEFAULT NULL,
  p_discharge_condition TEXT DEFAULT NULL,
  p_final_diagnosis_icd10 TEXT[] DEFAULT NULL,
  p_final_diagnosis_display TEXT[] DEFAULT NULL,
  p_hospital_course_summary TEXT DEFAULT NULL,
  p_procedures_done TEXT[] DEFAULT NULL,
  p_discharge_medications JSONB DEFAULT NULL,
  p_discharge_instructions TEXT DEFAULT NULL,
  p_follow_up_date DATE DEFAULT NULL,
  p_diet_advice TEXT DEFAULT NULL,
  p_activity_restrictions TEXT DEFAULT NULL,
  p_wound_care_instructions TEXT DEFAULT NULL,
  p_implant_details JSONB DEFAULT NULL,
  p_post_op_protocol TEXT DEFAULT NULL,
  p_physiotherapy_plan TEXT DEFAULT NULL
)
RETURNS JSONB
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
      hospital_course_summary, procedures_done,
      discharge_medications, discharge_instructions,
      follow_up_date, diet_advice, activity_restrictions,
      wound_care_instructions, implant_details,
      post_op_protocol, physiotherapy_plan,
      prepared_by, signed_by, signed_at
    ) VALUES (
      v_hospital_id, p_admission_id, v_patient_id, p_status,
      p_discharge_date, p_discharge_type, p_discharge_condition,
      p_final_diagnosis_icd10, p_final_diagnosis_display,
      p_hospital_course_summary, p_procedures_done,
      p_discharge_medications, p_discharge_instructions,
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

-- RLS
ALTER TABLE ipd_discharge_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discharge_summary_hospital_access" ON ipd_discharge_summaries;
CREATE POLICY "discharge_summary_hospital_access" ON ipd_discharge_summaries
  FOR ALL USING (
    hospital_id IN (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    )
  );

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at_discharge_summaries ON ipd_discharge_summaries;
CREATE TRIGGER set_updated_at_discharge_summaries
  BEFORE UPDATE ON ipd_discharge_summaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT EXECUTE ON FUNCTION compile_discharge_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_discharge_summary(UUID,TEXT,DATE,TEXT,TEXT,TEXT[],TEXT[],TEXT,TEXT[],JSONB,TEXT,DATE,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT) TO authenticated;
