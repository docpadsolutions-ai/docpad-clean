-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413164824.

-- ============================================================
-- STAFF SHIFTS: define expected working hours per staff/role
-- ============================================================
CREATE TABLE staff_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  shift_name TEXT NOT NULL DEFAULT 'General', -- 'Morning', 'Evening', 'Night'
  weekdays INT[] NOT NULL DEFAULT '{1,2,3,4,5,6}', -- 1=Mon..7=Sun
  shift_start TIME NOT NULL DEFAULT '09:00',
  shift_end   TIME NOT NULL DEFAULT '17:00',
  grace_minutes INT NOT NULL DEFAULT 15, -- late if login > shift_start + grace
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (practitioner_id, shift_name)
);

ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_staff_shifts" ON staff_shifts FOR ALL
  USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

-- ============================================================
-- STAFF ATTENDANCE: one row per staff per calendar day
-- Auto-populated from auth events / manual clock-in
-- ============================================================
CREATE TABLE staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  first_activity_at TIMESTAMPTZ,   -- first audit_log or login of the day
  last_activity_at  TIMESTAMPTZ,   -- last audit_log of the day
  shift_start TIME,                -- from staff_shifts at time of day
  is_present BOOLEAN DEFAULT FALSE,
  is_late BOOLEAN DEFAULT FALSE,
  late_by_minutes INT DEFAULT 0,
  manual_override BOOLEAN DEFAULT FALSE, -- admin manually marked
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (practitioner_id, attendance_date)
);

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_attendance" ON staff_attendance FOR ALL
  USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

-- updated_at trigger
CREATE TRIGGER set_staff_attendance_updated_at
  BEFORE UPDATE ON staff_attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for fast per-staff lookups
CREATE INDEX idx_staff_attendance_practitioner_date
  ON staff_attendance(practitioner_id, attendance_date DESC);

CREATE INDEX idx_staff_attendance_hospital_date
  ON staff_attendance(hospital_id, attendance_date DESC);

-- ============================================================
-- AUTO-UPSERT attendance from audit_logs
-- Fires on every audit_log INSERT to keep attendance current
-- ============================================================
CREATE OR REPLACE FUNCTION trg_upsert_attendance_from_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  SELECT id, hospital_id INTO v_practitioner_id, v_hospital_id
  FROM practitioners WHERE user_id = NEW.user_id LIMIT 1;

  IF v_practitioner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get their shift for today's weekday (EXTRACT DOW: 0=Sun,1=Mon...)
  SELECT * INTO v_shift
  FROM staff_shifts
  WHERE practitioner_id = v_practitioner_id
    AND is_active = TRUE
    AND EXTRACT(ISODOW FROM NEW.created_at) = ANY(weekdays)
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
    -- Only update lateness on first activity of the day
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

DROP TRIGGER IF EXISTS trig_attendance_from_audit ON audit_logs;
CREATE TRIGGER trig_attendance_from_audit
  AFTER INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION trg_upsert_attendance_from_audit();

-- Enable realtime on attendance
ALTER PUBLICATION supabase_realtime ADD TABLE staff_attendance;
