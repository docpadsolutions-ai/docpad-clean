-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413174814.

DROP FUNCTION IF EXISTS get_all_staff_performance_overview(DATE, DATE);

CREATE OR REPLACE FUNCTION get_all_staff_performance_overview(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  practitioner_id UUID,
  full_name TEXT,
  role TEXT,
  days_present INT,
  days_late INT,
  attendance_pct NUMERIC,
  total_actions BIGINT,
  opd_count BIGINT,
  last_active_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id UUID;
BEGIN
  SELECT pr2.hospital_id INTO v_hospital_id
  FROM practitioners pr2 WHERE pr2.user_id = auth.uid() LIMIT 1;

  RETURN QUERY
  SELECT
    pr.id AS practitioner_id,
    pr.full_name,
    pr.role,
    COALESCE(att.days_present, 0)::INT,
    COALESCE(att.days_late, 0)::INT,
    CASE WHEN COALESCE(att.total_days, 0) > 0
      THEN ROUND((att.days_present::NUMERIC / att.total_days) * 100, 1)
      ELSE 0::NUMERIC END AS attendance_pct,
    COALESCE(act.total_actions, 0),
    COALESCE(enc.opd_count, 0),
    act.last_active_at
  FROM practitioners pr
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE sa.is_present) AS days_present,
      COUNT(*) FILTER (WHERE sa.is_late) AS days_late,
      COUNT(*) AS total_days
    FROM staff_attendance sa
    WHERE sa.practitioner_id = pr.id
      AND sa.attendance_date BETWEEN p_date_from AND p_date_to
  ) att ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total_actions, MAX(al.created_at) AS last_active_at
    FROM audit_logs al
    WHERE al.user_id = pr.user_id
      AND al.hospital_id = v_hospital_id
      AND al.created_at::DATE BETWEEN p_date_from AND p_date_to
  ) act ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS opd_count
    FROM opd_encounters oe
    WHERE oe.doctor_id = pr.id
      AND oe.encounter_date BETWEEN p_date_from AND p_date_to
  ) enc ON TRUE
  WHERE pr.hospital_id = v_hospital_id
    AND pr.is_active = TRUE
  ORDER BY pr.full_name;
END;
$$;
