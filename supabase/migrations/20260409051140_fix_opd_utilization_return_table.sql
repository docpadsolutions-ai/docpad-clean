-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409051140.

DROP FUNCTION IF EXISTS get_opd_utilization(uuid, uuid, date, date);

CREATE FUNCTION get_opd_utilization(
  p_hospital_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_start_date date DEFAULT (CURRENT_DATE - 30),
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  department_name text,
  booked_slots bigint,
  total_available_slots integer,
  utilization_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days int;
BEGIN
  v_days := (p_end_date - p_start_date + 1);
  
  RETURN QUERY
  SELECT 
    COALESCE(d.department_name, 'Unknown') as department_name,
    COUNT(oe.id)::bigint as booked_slots,
    (v_days * 32) as total_available_slots,
    LEAST(
      ROUND((COUNT(oe.id)::numeric / NULLIF(v_days * 32, 0) * 100), 2),
      100.00
    ) as utilization_pct
  FROM opd_encounters oe
  LEFT JOIN departments d ON oe.department_id = d.id
  WHERE oe.hospital_id = p_hospital_id
    AND (p_department_id IS NULL OR oe.department_id = p_department_id)
    AND oe.checkin_time >= p_start_date
    AND oe.checkin_time < p_end_date + 1
  GROUP BY d.department_name
  ORDER BY booked_slots DESC;
END;
$$;
