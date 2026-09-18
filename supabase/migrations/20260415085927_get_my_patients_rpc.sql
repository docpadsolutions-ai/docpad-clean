-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415085927.

CREATE OR REPLACE FUNCTION get_my_patients(
  p_doctor_id UUID DEFAULT NULL,
  p_hospital_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  patient_id UUID,
  full_name TEXT,
  age_years INT,
  sex TEXT,
  phone TEXT,
  docpad_id TEXT,
  blood_group TEXT,
  known_allergies TEXT,
  chronic_conditions TEXT,
  total_encounters BIGINT,
  last_encounter_id UUID,
  last_encounter_date DATE,
  last_encounter_status TEXT,
  last_chief_complaint TEXT,
  last_diagnosis TEXT,
  last_follow_up_date DATE,
  first_seen_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (oe.patient_id)
    p.id AS patient_id,
    p.full_name,
    p.age_years,
    p.sex,
    p.phone,
    p.docpad_id,
    p.blood_group,
    p.known_allergies,
    p.chronic_conditions,
    COUNT(oe2.id) OVER (PARTITION BY oe.patient_id) AS total_encounters,
    oe.id AS last_encounter_id,
    oe.encounter_date AS last_encounter_date,
    oe.status AS last_encounter_status,
    oe.chief_complaint AS last_chief_complaint,
    COALESCE(oe.diagnosis_term, oe.working_diagnosis) AS last_diagnosis,
    oe.follow_up_date AS last_follow_up_date,
    MIN(oe2.encounter_date) OVER (PARTITION BY oe.patient_id) AS first_seen_date
  FROM opd_encounters oe
  JOIN patients p ON p.id = oe.patient_id
  LEFT JOIN opd_encounters oe2 
    ON oe2.patient_id = oe.patient_id 
    AND oe2.doctor_id = COALESCE(p_doctor_id, oe.doctor_id)
  WHERE
    oe.doctor_id = COALESCE(p_doctor_id, oe.doctor_id)
    AND oe.hospital_id = COALESCE(p_hospital_id, oe.hospital_id)
    AND (
      p_search IS NULL 
      OR p.full_name ILIKE '%' || p_search || '%'
      OR p.phone ILIKE '%' || p_search || '%'
      OR p.docpad_id ILIKE '%' || p_search || '%'
      OR oe.chief_complaint ILIKE '%' || p_search || '%'
    )
    AND (
      p_status IS NULL 
      OR oe.status = p_status
    )
  ORDER BY oe.patient_id, oe.encounter_date DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_my_patients TO authenticated;
