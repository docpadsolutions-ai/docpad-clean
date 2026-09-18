-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413175018.

CREATE OR REPLACE FUNCTION trg_upsert_attendance_from_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id UUID;
  v_hospital_id UUID;
  v_today DATE := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_time_ist TIME := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::TIME;
  v_shift RECORD;
  v_is_late BOOLEAN := FALSE;
  v_late_minutes INT := 0;
BEGIN
  -- Map user_id → practitioner
  SELECT pr.id, pr.hospital_id INTO v_practitioner_id, v_hospital_id
  FROM practitioners pr WHERE pr.user_id = NEW.user_id LIMIT 1;

  IF v_practitioner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get their shift for today's weekday (EXTRACT ISODOW: 1=Mon...7=Sun)
  SELECT ss.* INTO v_shift
  FROM staff_shifts ss
  WHERE ss.practitioner_id = v_practitioner_id
    AND ss.is_active = TRUE
    AND EXTRACT(ISODOW FROM NEW.created_at) = ANY(ss.weekdays)
  LIMIT 1;

  -- Compute lateness
  IF v_shift IS NOT NULL THEN
    IF v_time_ist > (v_shift.shift_start + (v_shift.grace_minutes || ' minutes')::INTERVAL)::TIME THEN
      v_is_late := TRUE;
      v_late_minutes := EXTRACT(EPOCH FROM (v_time_ist::INTERVAL - v_shift.shift_start::INTERVAL)) / 60;
    END IF;
  END IF;

  INSERT INTO staff_attendance (
    hospital_id, practitioner_id, attendance_date,
    first_activity_at, last_activity_at,
    shift_start, is_present, is_late, late_by_minutes
  ) VALUES (
    v_hospital_id, v_practitioner_id, v_today,
    NEW.created_at, NEW.created_at,
    v_shift.shift_start, TRUE,
    v_is_late, GREATEST(v_late_minutes, 0)
  )
  ON CONFLICT (practitioner_id, attendance_date) DO UPDATE SET
    last_activity_at = EXCLUDED.last_activity_at,
    is_present = TRUE,
    is_late = CASE
      WHEN staff_attendance.first_activity_at IS NULL THEN EXCLUDED.is_late
      ELSE staff_attendance.is_late
    END,
    late_by_minutes = CASE
      WHEN staff_attendance.first_activity_at IS NULL THEN EXCLUDED.late_by_minutes
      ELSE staff_attendance.late_by_minutes
    END,
    first_activity_at = COALESCE(staff_attendance.first_activity_at, EXCLUDED.first_activity_at),
    updated_at = now()
  WHERE staff_attendance.manual_override = FALSE;

  RETURN NEW;
END;
$$;
