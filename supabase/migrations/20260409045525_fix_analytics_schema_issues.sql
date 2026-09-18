-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409045525.

-- Add encounter_id to appointments table
ALTER TABLE appointments 
  ADD COLUMN encounter_id UUID REFERENCES opd_encounters(id) ON DELETE SET NULL;

-- Add check_in_time for wait time calculations
ALTER TABLE appointments
  ADD COLUMN check_in_time TIMESTAMP WITH TIME ZONE;

-- Create index for analytics queries
CREATE INDEX IF NOT EXISTS idx_appointments_encounter_id 
  ON appointments(encounter_id);

-- Update get_operational_daily_metrics to handle missing encounter link
DROP FUNCTION IF EXISTS get_operational_daily_metrics(uuid, date, date);

CREATE FUNCTION get_operational_daily_metrics(
  p_hospital_id uuid,
  p_start_date date DEFAULT (CURRENT_DATE - 30),
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  metric_date date,
  consultation_count integer,
  avg_wait_minutes numeric,
  avg_consult_minutes numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(oe.checkin_time),
    COUNT(oe.id)::int,
    AVG(
      CASE 
        WHEN a.check_in_time IS NOT NULL AND oe.checkin_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (oe.checkin_time - a.check_in_time)) / 60
        ELSE NULL
      END
    ),
    AVG(
      CASE 
        WHEN oe.checkout_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (oe.checkout_time - oe.checkin_time)) / 60
        ELSE NULL
      END
    )
  FROM opd_encounters oe
  LEFT JOIN appointments a ON oe.appointment_id = a.id
  WHERE oe.hospital_id = p_hospital_id
    AND oe.checkin_time >= p_start_date
    AND oe.checkin_time < p_end_date + 1
  GROUP BY DATE(oe.checkin_time)
  ORDER BY 1;
END;
$$;

-- Fix get_top_diagnoses to use opd_encounters diagnosis fields
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

COMMENT ON COLUMN appointments.encounter_id IS 'Link to created encounter after appointment conversion';
COMMENT ON COLUMN appointments.check_in_time IS 'Actual patient arrival time for wait time calculation';
