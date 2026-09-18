-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413164858.

-- ============================================================
-- RPC: get_staff_activity_log
-- Paginated audit trail for one practitioner
-- ============================================================
CREATE OR REPLACE FUNCTION get_staff_activity_log(
  p_practitioner_id UUID,
  p_date_from DATE DEFAULT (CURRENT_DATE - 7),
  p_date_to DATE DEFAULT CURRENT_DATE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  action TEXT,
  resource_type TEXT,
  resource_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_hospital_id UUID;
BEGIN
  SELECT user_id, hospital_id INTO v_user_id, v_hospital_id
  FROM practitioners WHERE id = p_practitioner_id;

  -- Caller must belong to same hospital
  IF v_hospital_id NOT IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.action,
    a.resource_type,
    a.resource_id,
    COALESCE(
      (a.new_values->>'description'),
      (a.new_values->>'title'),
      (a.new_values->>'name'),
      a.action || ' on ' || a.resource_type
    ) AS description,
    a.created_at
  FROM audit_logs a
  WHERE
    a.user_id = v_user_id
    AND a.hospital_id = v_hospital_id
    AND a.created_at::DATE BETWEEN p_date_from AND p_date_to
  ORDER BY a.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ============================================================
-- RPC: get_staff_performance_summary
-- KPIs for one staff member over a date range
-- ============================================================
CREATE OR REPLACE FUNCTION get_staff_performance_summary(
  p_practitioner_id UUID,
  p_date_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_hospital_id UUID;
  v_role TEXT;
  v_result JSONB := '{}';

  -- Attendance
  v_days_present INT;
  v_days_late INT;
  v_working_days INT;
  v_avg_late_mins NUMERIC;

  -- Clinical activity (doctors)
  v_opd_encounters INT;
  v_ipd_notes INT;
  v_prescriptions INT;
  v_investigations_ordered INT;

  -- Nursing activity
  v_vitals_recorded INT;
  v_nursing_notes INT;
  v_medications_given INT;

  -- General
  v_total_actions INT;
BEGIN
  SELECT user_id, hospital_id, role INTO v_user_id, v_hospital_id, v_role
  FROM practitioners WHERE id = p_practitioner_id;

  IF v_hospital_id NOT IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Attendance stats
  SELECT
    COUNT(*) FILTER (WHERE is_present),
    COUNT(*) FILTER (WHERE is_late),
    COUNT(*),
    ROUND(AVG(late_by_minutes) FILTER (WHERE is_late), 1)
  INTO v_days_present, v_days_late, v_working_days, v_avg_late_mins
  FROM staff_attendance
  WHERE practitioner_id = p_practitioner_id
    AND attendance_date BETWEEN p_date_from AND p_date_to;

  -- Total audit actions
  SELECT COUNT(*) INTO v_total_actions
  FROM audit_logs
  WHERE user_id = v_user_id
    AND hospital_id = v_hospital_id
    AND created_at::DATE BETWEEN p_date_from AND p_date_to;

  v_result := jsonb_build_object(
    'attendance', jsonb_build_object(
      'days_present', COALESCE(v_days_present, 0),
      'days_late', COALESCE(v_days_late, 0),
      'working_days_logged', COALESCE(v_working_days, 0),
      'attendance_pct', CASE WHEN v_working_days > 0
        THEN ROUND((v_days_present::NUMERIC / v_working_days) * 100, 1) ELSE 0 END,
      'avg_late_minutes', COALESCE(v_avg_late_mins, 0)
    ),
    'activity', jsonb_build_object(
      'total_actions', COALESCE(v_total_actions, 0)
    )
  );

  -- Doctor-specific KPIs
  IF v_role IN ('doctor', 'admin', 'Doctor', 'Admin') THEN
    SELECT COUNT(*) INTO v_opd_encounters
    FROM opd_encounters
    WHERE doctor_id = p_practitioner_id
      AND encounter_date BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_ipd_notes
    FROM ipd_progress_notes
    WHERE doctor_id = p_practitioner_id
      AND created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_prescriptions
    FROM audit_logs
    WHERE user_id = v_user_id
      AND resource_type IN ('prescription', 'opd_prescription')
      AND action = 'INSERT'
      AND created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_investigations_ordered
    FROM audit_logs
    WHERE user_id = v_user_id
      AND resource_type IN ('investigation_order', 'ipd_investigation_order')
      AND action = 'INSERT'
      AND created_at::DATE BETWEEN p_date_from AND p_date_to;

    v_result := v_result || jsonb_build_object(
      'clinical', jsonb_build_object(
        'opd_encounters', COALESCE(v_opd_encounters, 0),
        'ipd_progress_notes', COALESCE(v_ipd_notes, 0),
        'prescriptions_written', COALESCE(v_prescriptions, 0),
        'investigations_ordered', COALESCE(v_investigations_ordered, 0)
      )
    );
  END IF;

  -- Nurse-specific KPIs
  IF v_role IN ('nurse', 'Nurse') THEN
    SELECT COUNT(*) INTO v_vitals_recorded
    FROM audit_logs
    WHERE user_id = v_user_id
      AND resource_type IN ('vitals', 'ipd_vitals')
      AND action = 'INSERT'
      AND created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_nursing_notes
    FROM audit_logs
    WHERE user_id = v_user_id
      AND resource_type = 'nursing_care_plan'
      AND created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_medications_given
    FROM audit_logs
    WHERE user_id = v_user_id
      AND resource_type = 'ipd_mar'
      AND action = 'INSERT'
      AND created_at::DATE BETWEEN p_date_from AND p_date_to;

    v_result := v_result || jsonb_build_object(
      'nursing', jsonb_build_object(
        'vitals_recorded', COALESCE(v_vitals_recorded, 0),
        'nursing_notes', COALESCE(v_nursing_notes, 0),
        'medications_administered', COALESCE(v_medications_given, 0)
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================
-- RPC: get_staff_attendance_calendar
-- Returns attendance status for each day in range (for heatmap)
-- ============================================================
CREATE OR REPLACE FUNCTION get_staff_attendance_calendar(
  p_practitioner_id UUID,
  p_date_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  attendance_date DATE,
  is_present BOOLEAN,
  is_late BOOLEAN,
  late_by_minutes INT,
  first_activity_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  hours_active NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
BEGIN
  SELECT hospital_id INTO v_hospital_id FROM practitioners WHERE id = p_practitioner_id;
  IF v_hospital_id NOT IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    a.attendance_date,
    a.is_present,
    a.is_late,
    a.late_by_minutes,
    a.first_activity_at,
    a.last_activity_at,
    ROUND(
      EXTRACT(EPOCH FROM (a.last_activity_at - a.first_activity_at)) / 3600.0, 1
    ) AS hours_active
  FROM staff_attendance a
  WHERE a.practitioner_id = p_practitioner_id
    AND a.attendance_date BETWEEN p_date_from AND p_date_to
  ORDER BY a.attendance_date DESC;
END;
$$;

-- ============================================================
-- RPC: get_all_staff_performance_overview
-- For the staff directory page — one row per staff member
-- ============================================================
CREATE OR REPLACE FUNCTION get_all_staff_performance_overview(
  p_date_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  practitioner_id UUID,
  full_name TEXT,
  role TEXT,
  days_present INT,
  days_late INT,
  attendance_pct NUMERIC,
  total_actions BIGINT,
  opd_encounters BIGINT,
  last_active_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
BEGIN
  SELECT hospital_id INTO v_hospital_id
  FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

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
      COUNT(*) FILTER (WHERE is_present) AS days_present,
      COUNT(*) FILTER (WHERE is_late) AS days_late,
      COUNT(*) AS total_days
    FROM staff_attendance
    WHERE practitioner_id = pr.id
      AND attendance_date BETWEEN p_date_from AND p_date_to
  ) att ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total_actions, MAX(created_at) AS last_active_at
    FROM audit_logs
    WHERE user_id = pr.user_id
      AND hospital_id = v_hospital_id
      AND created_at::DATE BETWEEN p_date_from AND p_date_to
  ) act ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS opd_count
    FROM opd_encounters
    WHERE doctor_id = pr.id
      AND encounter_date BETWEEN p_date_from AND p_date_to
  ) enc ON TRUE
  WHERE pr.hospital_id = v_hospital_id
    AND pr.is_active = TRUE
  ORDER BY pr.full_name;
END;
$$;
