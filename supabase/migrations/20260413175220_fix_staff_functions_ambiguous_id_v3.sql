-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413175220.

-- Fix get_staff_performance_summary
DROP FUNCTION IF EXISTS get_staff_performance_summary(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION get_staff_performance_summary(
  p_practitioner_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_hospital_id UUID;
  v_role TEXT;
  v_result JSONB := '{}';
  v_days_present INT;
  v_days_late INT;
  v_working_days INT;
  v_avg_late_mins NUMERIC;
  v_opd_encounters INT;
  v_ipd_notes INT;
  v_prescriptions INT;
  v_investigations_ordered INT;
  v_vitals_recorded INT;
  v_nursing_notes INT;
  v_medications_given INT;
  v_total_actions INT;
BEGIN
  SELECT pr.user_id, pr.hospital_id, pr.role INTO v_user_id, v_hospital_id, v_role
  FROM practitioners pr WHERE pr.id = p_practitioner_id;

  IF v_hospital_id NOT IN (SELECT pr2.hospital_id FROM practitioners pr2 WHERE pr2.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE sa.is_present),
    COUNT(*) FILTER (WHERE sa.is_late),
    COUNT(*),
    ROUND(AVG(sa.late_by_minutes) FILTER (WHERE sa.is_late), 1)
  INTO v_days_present, v_days_late, v_working_days, v_avg_late_mins
  FROM staff_attendance sa
  WHERE sa.practitioner_id = p_practitioner_id
    AND sa.attendance_date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_total_actions
  FROM audit_logs al
  WHERE al.user_id = v_user_id
    AND al.hospital_id = v_hospital_id
    AND al.created_at::DATE BETWEEN p_date_from AND p_date_to;

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

  IF v_role IN ('doctor', 'admin', 'Doctor', 'Admin') THEN
    SELECT COUNT(*) INTO v_opd_encounters
    FROM opd_encounters oe
    WHERE oe.doctor_id = p_practitioner_id
      AND oe.encounter_date BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_ipd_notes
    FROM ipd_progress_notes ipn
    WHERE ipn.doctor_id = p_practitioner_id
      AND ipn.created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_prescriptions
    FROM audit_logs al
    WHERE al.user_id = v_user_id
      AND al.resource_type IN ('prescription', 'opd_prescription')
      AND al.action = 'INSERT'
      AND al.created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_investigations_ordered
    FROM audit_logs al
    WHERE al.user_id = v_user_id
      AND al.resource_type IN ('investigation_order', 'ipd_investigation_order')
      AND al.action = 'INSERT'
      AND al.created_at::DATE BETWEEN p_date_from AND p_date_to;

    v_result := v_result || jsonb_build_object(
      'clinical', jsonb_build_object(
        'opd_encounters', COALESCE(v_opd_encounters, 0),
        'ipd_progress_notes', COALESCE(v_ipd_notes, 0),
        'prescriptions_written', COALESCE(v_prescriptions, 0),
        'investigations_ordered', COALESCE(v_investigations_ordered, 0)
      )
    );
  END IF;

  IF v_role IN ('nurse', 'Nurse') THEN
    SELECT COUNT(*) INTO v_vitals_recorded
    FROM audit_logs al
    WHERE al.user_id = v_user_id
      AND al.resource_type IN ('vitals', 'ipd_vitals')
      AND al.action = 'INSERT'
      AND al.created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_nursing_notes
    FROM audit_logs al
    WHERE al.user_id = v_user_id
      AND al.resource_type = 'nursing_care_plan'
      AND al.created_at::DATE BETWEEN p_date_from AND p_date_to;

    SELECT COUNT(*) INTO v_medications_given
    FROM audit_logs al
    WHERE al.user_id = v_user_id
      AND al.resource_type = 'ipd_mar'
      AND al.action = 'INSERT'
      AND al.created_at::DATE BETWEEN p_date_from AND p_date_to;

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

-- Fix get_staff_activity_log
DROP FUNCTION IF EXISTS get_staff_activity_log(UUID, DATE, DATE, INT, INT);
CREATE OR REPLACE FUNCTION get_staff_activity_log(
  p_practitioner_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
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
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_hospital_id UUID;
BEGIN
  SELECT pr.user_id, pr.hospital_id INTO v_user_id, v_hospital_id
  FROM practitioners pr WHERE pr.id = p_practitioner_id;

  IF v_hospital_id NOT IN (SELECT pr2.hospital_id FROM practitioners pr2 WHERE pr2.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.action,
    al.resource_type,
    al.resource_id,
    COALESCE(
      (al.new_values->>'description'),
      (al.new_values->>'title'),
      (al.new_values->>'name'),
      al.action || ' on ' || al.resource_type
    ) AS description,
    al.created_at
  FROM audit_logs al
  WHERE al.user_id = v_user_id
    AND al.hospital_id = v_hospital_id
    AND al.created_at::DATE BETWEEN p_date_from AND p_date_to
  ORDER BY al.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Fix get_staff_attendance_calendar
DROP FUNCTION IF EXISTS get_staff_attendance_calendar(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION get_staff_attendance_calendar(
  p_practitioner_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
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
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id UUID;
BEGIN
  SELECT pr.hospital_id INTO v_hospital_id FROM practitioners pr WHERE pr.id = p_practitioner_id;

  IF v_hospital_id NOT IN (SELECT pr2.hospital_id FROM practitioners pr2 WHERE pr2.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    sa.attendance_date,
    sa.is_present,
    sa.is_late,
    sa.late_by_minutes,
    sa.first_activity_at,
    sa.last_activity_at,
    ROUND(
      EXTRACT(EPOCH FROM (sa.last_activity_at - sa.first_activity_at)) / 3600.0, 1
    ) AS hours_active
  FROM staff_attendance sa
  WHERE sa.practitioner_id = p_practitioner_id
    AND sa.attendance_date BETWEEN p_date_from AND p_date_to
  ORDER BY sa.attendance_date DESC;
END;
$$;
