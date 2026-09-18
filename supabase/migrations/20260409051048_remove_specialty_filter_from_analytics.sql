-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409051048.

-- Fix get_top_diagnoses - remove oe.specialty filter (column doesn't exist)
-- Specialty filtering not supported since encounters don't have specialty column
DROP FUNCTION IF EXISTS get_top_diagnoses(uuid, text, date, date, integer);

CREATE FUNCTION get_top_diagnoses(
  p_hospital_id uuid,
  p_specialty text DEFAULT NULL,
  p_start_date date DEFAULT (CURRENT_DATE - 30),
  p_end_date date DEFAULT CURRENT_DATE,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  diagnosis_term text,
  diagnosis_code text,
  occurrence_count bigint,
  percentage numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_count bigint;
BEGIN
  -- Note: p_specialty parameter ignored - no specialty column in opd_encounters
  -- Get total count for percentage calculation
  SELECT COUNT(*) INTO v_total_count
  FROM opd_encounters oe
  WHERE oe.hospital_id = p_hospital_id
    AND oe.encounter_date >= p_start_date
    AND oe.encounter_date <= p_end_date
    AND oe.diagnosis_term IS NOT NULL;

  RETURN QUERY
  SELECT 
    oe.diagnosis_term,
    COALESCE(oe.diagnosis_concept_id, oe.diagnosis_snomed, oe.diagnosis_icd10) as diagnosis_code,
    COUNT(*)::bigint as occurrence_count,
    ROUND((COUNT(*)::numeric / NULLIF(v_total_count, 0) * 100), 2) as percentage
  FROM opd_encounters oe
  WHERE oe.hospital_id = p_hospital_id
    AND oe.encounter_date >= p_start_date
    AND oe.encounter_date <= p_end_date
    AND oe.diagnosis_term IS NOT NULL
  GROUP BY oe.diagnosis_term, diagnosis_code
  ORDER BY occurrence_count DESC
  LIMIT p_limit;
END;
$$;

-- Fix get_prescription_patterns - remove specialty filter
DROP FUNCTION IF EXISTS get_prescription_patterns(uuid, text, date, date, integer);

CREATE FUNCTION get_prescription_patterns(
  p_hospital_id uuid,
  p_specialty text DEFAULT NULL,
  p_start_date date DEFAULT (CURRENT_DATE - 30),
  p_end_date date DEFAULT CURRENT_DATE,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  medicine_name text,
  prescription_count bigint,
  avg_duration numeric,
  common_dosage text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Note: p_specialty parameter ignored - no specialty column available
  RETURN QUERY
  SELECT 
    p.medicine_name,
    COUNT(*)::bigint as prescription_count,
    AVG(
      CASE 
        WHEN p.duration ~ '^[0-9]+$' 
        THEN p.duration::integer 
        ELSE NULL 
      END
    ) as avg_duration,
    MODE() WITHIN GROUP (ORDER BY p.dosage_text) as common_dosage
  FROM prescriptions p
  JOIN opd_encounters oe ON p.encounter_id = oe.id
  WHERE oe.hospital_id = p_hospital_id
    AND oe.encounter_date >= p_start_date
    AND oe.encounter_date <= p_end_date
    AND p.medicine_name IS NOT NULL
  GROUP BY p.medicine_name
  ORDER BY prescription_count DESC
  LIMIT p_limit;
END;
$$;
