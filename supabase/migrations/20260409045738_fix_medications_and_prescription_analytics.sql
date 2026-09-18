-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409045738.

-- Fix get_avg_meds_per_encounter to use prescriptions table
DROP FUNCTION IF EXISTS get_avg_meds_per_encounter(uuid, date, date);

CREATE FUNCTION get_avg_meds_per_encounter(
  p_hospital_id uuid,
  p_start_date date DEFAULT (CURRENT_DATE - 30),
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_avg numeric;
BEGIN
  WITH counts AS (
    SELECT 
      oe.id,
      COUNT(p.id) as cnt
    FROM opd_encounters oe
    LEFT JOIN prescriptions p ON oe.id = p.encounter_id
    WHERE oe.hospital_id = p_hospital_id
      AND oe.checkin_time >= p_start_date
      AND oe.checkin_time < p_end_date + 1
    GROUP BY oe.id
  )
  SELECT AVG(cnt) INTO v_avg FROM counts;
  
  RETURN COALESCE(v_avg, 0);
END;
$$;

-- Fix get_prescription_patterns to use prescriptions table
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
