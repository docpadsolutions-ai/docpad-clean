-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411153827.

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
  SELECT a.*, d.name AS department_name, w.name AS ward_name
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

  SELECT pt.id, pt.full_name, pt.date_of_birth, pt.sex, pt.docpad_id,
    pt.phone, pt.address_line1, pt.age_years, pt.blood_group,
    pt.known_allergies, pt.chronic_conditions
  INTO v_patient
  FROM patients pt WHERE pt.id = v_admission.patient_id;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', pn.id,
      'note_date', pn.note_date,
      'hospital_day_number', pn.hospital_day_number,
      'day_label', pn.day_label,
      'is_surgery_day', pn.is_surgery_day,
      'post_op_day', pn.post_op_day,
      'condition_status', pn.condition_status,
      'pain_score', pn.pain_score,
      'subjective', pn.subjective_text,
      'objective', pn.objective_text,
      'assessment', pn.assessment_text,
      'plan', pn.plan_text,
      'plan_narrative', pn.plan_narrative,
      'vitals', JSONB_BUILD_OBJECT(
        'hr', pn.heart_rate,
        'bp_sys', pn.bp_systolic,
        'bp_dia', pn.bp_diastolic,
        'rr', pn.respiratory_rate,
        'temp', pn.temperature_c,
        'spo2', pn.spo2
      ),
      'wound_status', pn.wound_status,
      'drain_status', pn.drain_status,
      'rom_active', pn.rom_active,
      'rom_passive', pn.rom_passive,
      'treatments', pn.treatments_json,
      'symptoms', pn.symptoms_json
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
      'result_text', io.result_text,
      'is_critical', io.is_critical,
      'priority', io.priority,
      'status', io.status,
      'reported_at', io.result_available_at
    ) ORDER BY io.ordered_date, io.test_name
  )
  INTO v_investigations
  FROM ipd_investigation_orders io
  WHERE io.admission_id = p_admission_id;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'name', t.name,
      'treatment_kind', t.treatment_kind,
      'description', t.description,
      'dose', t.dose,
      'route', t.route,
      'frequency', t.frequency,
      'duration_days', t.duration_days,
      'ordered_date', t.ordered_date,
      'end_date', t.end_date,
      'status', t.status
    ) ORDER BY t.ordered_date
  )
  INTO v_treatments
  FROM ipd_treatments t
  WHERE t.admission_id = p_admission_id;

  SELECT
    os.id, os.procedure_name, os.surgery_date, os.anaesthesia_type,
    os.intraop_notes, os.implants_used, os.estimated_duration_mins,
    os.laterality, os.blood_loss_ml, os.complications, os.status,
    os.actual_start_time, os.actual_end_time,
    p_surg.full_name AS surgeon_name
  INTO v_surgery
  FROM ot_surgeries os
  LEFT JOIN practitioners p_surg ON p_surg.id = os.primary_surgeon_id
  WHERE os.admission_id = p_admission_id
  ORDER BY os.surgery_date DESC LIMIT 1;

  SELECT * INTO v_existing_draft
  FROM ipd_discharge_summaries
  WHERE admission_id = p_admission_id LIMIT 1;

  RETURN JSONB_BUILD_OBJECT(
    'patient', JSONB_BUILD_OBJECT(
      'id', v_patient.id,
      'name', v_patient.full_name,
      'uhid', v_patient.docpad_id,
      'age', v_patient.age_years,
      'sex', v_patient.sex,
      'phone', v_patient.phone,
      'address', v_patient.address_line1,
      'dob', v_patient.date_of_birth,
      'blood_group', v_patient.blood_group,
      'known_allergies', v_patient.known_allergies,
      'chronic_conditions', v_patient.chronic_conditions
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
        'name', v_surgery.procedure_name,
        'date', v_surgery.surgery_date,
        'anaesthesia', v_surgery.anaesthesia_type,
        'surgeon', v_surgery.surgeon_name,
        'notes', v_surgery.intraop_notes,
        'implants', v_surgery.implants_used,
        'duration_minutes', v_surgery.estimated_duration_mins,
        'laterality', v_surgery.laterality,
        'blood_loss_ml', v_surgery.blood_loss_ml,
        'complications', v_surgery.complications,
        'actual_start_time', v_surgery.actual_start_time,
        'actual_end_time', v_surgery.actual_end_time
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

GRANT EXECUTE ON FUNCTION compile_discharge_summary(UUID) TO authenticated;
