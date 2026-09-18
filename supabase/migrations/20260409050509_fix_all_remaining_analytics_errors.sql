-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409050509.

-- Fix get_investigation_tat (EXTRACT syntax error)
DROP FUNCTION IF EXISTS get_investigation_tat(uuid, date, date);

CREATE FUNCTION get_investigation_tat(
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
  v_avg_hours numeric;
BEGIN
  -- Calculate average TAT in hours from lab_orders table if it exists
  -- Otherwise return 0 as placeholder
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'lab_orders'
  ) THEN
    SELECT AVG(
      EXTRACT(EPOCH FROM (completed_at - ordered_at)) / 3600
    ) INTO v_avg_hours
    FROM lab_orders
    WHERE hospital_id = p_hospital_id
      AND ordered_at >= p_start_date
      AND ordered_at < p_end_date + 1
      AND completed_at IS NOT NULL;
  ELSE
    v_avg_hours := 0;
  END IF;
  
  RETURN COALESCE(v_avg_hours, 0);
END;
$$;

-- Fix get_avg_wait_time (EXTRACT syntax error)
DROP FUNCTION IF EXISTS get_avg_wait_time(uuid, date, date);

CREATE FUNCTION get_avg_wait_time(
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
  SELECT AVG(
    EXTRACT(EPOCH FROM (oe.checkin_time - a.check_in_time)) / 60
  ) INTO v_avg
  FROM opd_encounters oe
  JOIN appointments a ON oe.appointment_id = a.id
  WHERE oe.hospital_id = p_hospital_id
    AND oe.checkin_time >= p_start_date
    AND oe.checkin_time < p_end_date + 1
    AND a.check_in_time IS NOT NULL
    AND oe.checkin_time IS NOT NULL;
  
  RETURN COALESCE(v_avg, 0);
END;
$$;

-- Fix get_clinical_highlights (hpi column doesn't exist)
DROP FUNCTION IF EXISTS get_clinical_highlights(uuid);

CREATE FUNCTION get_clinical_highlights(p_patient_id uuid)
RETURNS TABLE(
  highlight_type text,
  content text,
  recorded_date date,
  severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  -- Active problems
  SELECT 
    'active_problem'::text,
    problem_text::text,
    onset_date,
    clinical_status::text
  FROM patient_problems
  WHERE patient_id = p_patient_id
    AND clinical_status = 'active'
  
  UNION ALL
  
  -- Recent diagnoses
  SELECT 
    'diagnosis'::text,
    diagnosis_term::text,
    encounter_date,
    'active'::text
  FROM opd_encounters
  WHERE patient_id = p_patient_id
    AND diagnosis_term IS NOT NULL
    AND encounter_date >= CURRENT_DATE - 90
  
  ORDER BY 3 DESC
  LIMIT 10;
END;
$$;
