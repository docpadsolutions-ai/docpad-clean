-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414134037.

-- Fix get_care_team
CREATE OR REPLACE FUNCTION get_care_team(p_patient_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_doctors JSON;
  v_facilities JSON;
BEGIN
  SELECT json_agg(doctor_data)
  INTO v_doctors
  FROM (
    SELECT DISTINCT ON (prac.id)
      jsonb_build_object(
        'id', prac.id,
        'name', prac.full_name,
        'specialty', prac.specialty,
        'facility', h.name,
        'lastVisit', MAX(enc.encounter_date) OVER (PARTITION BY prac.id)
      ) as doctor_data
    FROM opd_encounters enc
    JOIN practitioners prac ON enc.doctor_id = prac.id
    LEFT JOIN hospitals h ON prac.hospital_id = h.id
    WHERE enc.patient_id = p_patient_id
    ORDER BY prac.id, enc.encounter_date DESC
  ) doctors
  LIMIT 5;

  SELECT json_agg(facility_data)
  INTO v_facilities
  FROM (
    SELECT DISTINCT ON (h.id)
      jsonb_build_object(
        'id', h.id,
        'name', h.name,
        'type', 'Multi-specialty Hospital'
      ) as facility_data
    FROM opd_encounters enc
    JOIN hospitals h ON enc.hospital_id = h.id
    WHERE enc.patient_id = p_patient_id
  ) facilities;

  RETURN json_build_object(
    'doctors', COALESCE(v_doctors, '[]'::json),
    'facilities', COALESCE(v_facilities, '[]'::json)
  );
END;
$$;

-- Fix get_health_timeline_nodes
CREATE OR REPLACE FUNCTION get_health_timeline_nodes(p_patient_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'id', enc.id,
      'encounterId', enc.id,
      'date', enc.encounter_date,
      'type', 'OPD',
      'significance', CASE 
        WHEN enc.status = 'in_progress' THEN 'major'
        WHEN enc.diagnosis_term IS NOT NULL THEN 'significant'
        ELSE 'routine'
      END,
      'title', COALESCE(enc.chief_complaint_term, enc.chief_complaint, 'OPD Visit'),
      'doctor', prac.full_name,
      'doctorId', prac.id,
      'hospital', h.name,
      'summary', enc.diagnosis_term,
      'chiefComplaint', enc.chief_complaint_term,
      'diagnosis', enc.diagnosis_term,
      'status', enc.status
    )
    ORDER BY enc.encounter_date DESC
  )
  INTO v_result
  FROM opd_encounters enc
  LEFT JOIN practitioners prac ON enc.doctor_id = prac.id
  LEFT JOIN hospitals h ON enc.hospital_id = h.id
  WHERE enc.patient_id = p_patient_id
    AND enc.status != 'cancelled';

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Fix get_encounter_details
CREATE OR REPLACE FUNCTION get_encounter_details(p_encounter_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_medications JSON;
  v_vitals JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'medicineName', prx.medicine_name,
      'dosage', prx.dosage,
      'frequency', prx.frequency,
      'duration', prx.duration,
      'instructions', prx.instructions
    )
  )
  INTO v_medications
  FROM prescriptions prx
  WHERE prx.encounter_id = p_encounter_id;

  SELECT json_build_object(
    'weight', enc.weight,
    'bp', enc.blood_pressure,
    'pulse', enc.pulse,
    'temp', enc.temperature,
    'spo2', enc.spo2
  )
  INTO v_vitals
  FROM opd_encounters enc
  WHERE enc.id = p_encounter_id;

  SELECT json_build_object(
    'id', enc.id,
    'encounterId', enc.encounter_number,
    'date', enc.encounter_date,
    'time', enc.scheduled_time,
    'type', 'OPD',
    'status', enc.status,
    'doctor', prac.full_name,
    'specialty', prac.specialty,
    'hospital', h.name,
    'chiefComplaint', enc.chief_complaint_term,
    'diagnosis', enc.diagnosis_term,
    'examination', enc.quick_exam,
    'clinicalNotes', enc.clinical_notes,
    'vitals', v_vitals,
    'medications', COALESCE(v_medications, '[]'::json),
    'followUpDate', enc.follow_up_date,
    'isActive', CASE WHEN enc.status = 'in_progress' THEN true ELSE false END
  )
  INTO v_result
  FROM opd_encounters enc
  LEFT JOIN practitioners prac ON enc.doctor_id = prac.id
  LEFT JOIN hospitals h ON enc.hospital_id = h.id
  WHERE enc.id = p_encounter_id;

  RETURN v_result;
END;
$$;

-- Fix generate_prescription_receipt
CREATE OR REPLACE FUNCTION generate_prescription_receipt(prescription_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  receipt JSON;
BEGIN
  SELECT json_build_object(
    'receipt_number', 'RX-' || SUBSTRING(prescription_id::TEXT, 1, 12),
    'dispensed_at', p.dispensed_at,
    'patient', json_build_object(
      'name', pt.full_name,
      'docpad_id', pt.docpad_id,
      'age', COALESCE(pt.age_years, 0),
      'sex', COALESCE(pt.sex, 'unknown')
    ),
    'medication', json_build_object(
      'name', p.medicine_name,
      'dosage', COALESCE(p.dosage_text, ''),
      'frequency', COALESCE(p.frequency, ''),
      'duration', COALESCE(p.duration, ''),
      'dispensed_quantity', p.total_quantity,
      'total_quantity', p.total_quantity,
      'instructions', COALESCE(p.instructions, '')
    ),
    'pharmacist', json_build_object(
      'name', COALESCE(pr.full_name, 'Not assigned'),
      'registration', pr.registration_no
    ),
    'hospital', json_build_object(
      'name', h.name
    )
  ) INTO receipt
  FROM prescriptions p
  JOIN opd_encounters e ON p.encounter_id = e.id
  JOIN patients pt ON e.patient_id = pt.id
  JOIN hospitals h ON e.hospital_id = h.id
  LEFT JOIN practitioners pr ON p.dispensed_by = pr.id
  WHERE p.id = prescription_id;

  RETURN receipt;
END;
$$;
