-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411080316.

CREATE OR REPLACE FUNCTION public.get_ipd_admission(p_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'admission',  jsonb_build_object(
                    'id', a.id,
                    'admission_number', a.admission_number,
                    'admission_type', a.admission_type,
                    'status', a.status,
                    'admitted_at', a.admitted_at,
                    'expected_discharge_date', a.expected_discharge_date,
                    'primary_diagnosis_icd10', a.primary_diagnosis_icd10,
                    'primary_diagnosis_display', a.primary_diagnosis_display,
                    'specialty', a.specialty,
                    'source_opd_encounter_id', a.source_opd_encounter_id,
                    'pre_admission_assessment_id', a.pre_admission_assessment_id
                  ),
    'patient',    jsonb_build_object(
                    'id', p.id, 'full_name', p.full_name, 'date_of_birth', p.date_of_birth,
                    'sex', p.sex, 'docpad_id', p.docpad_id, 'blood_group', p.blood_group,
                    'known_allergies', p.known_allergies, 'abha_number', p.abha_number
                  ),
    'ward',       jsonb_build_object('id', w.id, 'name', w.name, 'ward_type', w.ward_type),
    'bed',        jsonb_build_object('id', b.id, 'bed_number', b.bed_number, 'bed_type', b.bed_type),
    'doctor',     jsonb_build_object('id', dr.id, 'full_name', dr.full_name, 'specialty', dr.specialty),
    'pre_admission', CASE WHEN pa.id IS NOT NULL THEN jsonb_build_object(
                    'id', pa.id,
                    'chief_complaint', pa.chief_complaint,
                    'chief_complaint_onset', pa.chief_complaint_onset,
                    'chief_complaint_duration', pa.chief_complaint_duration,
                    'hpi_one_liner', pa.hpi_one_liner,
                    'hpi_narrative', pa.hpi_narrative,
                    'symptoms_json', pa.symptoms_json,
                    'pmh_text', pa.pmh_text,
                    'current_medications', pa.current_medications,
                    'allergies_text', pa.allergies_text,
                    'risk_factors', pa.risk_factors,
                    'heart_rate', pa.heart_rate,
                    'bp_systolic', pa.bp_systolic,
                    'bp_diastolic', pa.bp_diastolic,
                    'temperature_f', pa.temperature_f,
                    'spo2', pa.spo2,
                    'respiratory_rate', pa.respiratory_rate,
                    'general_appearance', pa.general_appearance,
                    'systemic_examination', pa.systemic_examination,
                    'local_examination', pa.local_examination,
                    'primary_diagnosis_icd10', pa.primary_diagnosis_icd10,
                    'primary_diagnosis_display', pa.primary_diagnosis_display,
                    'differential_diagnosis', pa.differential_diagnosis,
                    'treatment_plan_notes', pa.treatment_plan_notes,
                    'surgical_plan_notes', pa.surgical_plan_notes,
                    'anaesthesia_fitness', pa.anaesthesia_fitness,
                    'specialty', pa.specialty,
                    'assessed_at', pa.assessed_at,
                    'status', pa.status
                  ) ELSE NULL END,
    'consents',   (SELECT jsonb_agg(jsonb_build_object(
                    'id', c.id, 'type_code', ct.code, 'type_name', ct.display_name,
                    'description', ct.description,
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
  LEFT JOIN public.ipd_pre_admission_assessments pa ON pa.id = a.pre_admission_assessment_id
  WHERE a.id = p_admission_id;

  RETURN v_result;
END;
$function$;
