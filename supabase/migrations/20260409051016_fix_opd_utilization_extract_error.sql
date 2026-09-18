-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409051016.

DROP FUNCTION IF EXISTS get_opd_utilization(uuid, uuid, date, date);

CREATE FUNCTION get_opd_utilization(
  p_hospital_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_start_date date DEFAULT (CURRENT_DATE - 30),
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_util numeric;
  v_enc int;
  v_cap int;
BEGIN
  SELECT COUNT(*) INTO v_enc
  FROM opd_encounters
  WHERE hospital_id = p_hospital_id
    AND (p_department_id IS NULL OR department_id = p_department_id)
    AND checkin_time >= p_start_date
    AND checkin_time < p_end_date + 1;
  
  -- Calculate capacity: days * average slots per day
  v_cap := (p_end_date - p_start_date + 1) * 32;
  
  v_util := CASE 
    WHEN v_cap > 0 THEN (v_enc::numeric / v_cap * 100) 
    ELSE 0 
  END;
  
  RETURN LEAST(v_util, 100);
END;
$$;
