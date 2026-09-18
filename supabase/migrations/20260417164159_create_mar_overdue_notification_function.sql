-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417164159.

-- Function to fire notifications for MAR slots overdue by 2 hours
CREATE OR REPLACE FUNCTION public.notify_overdue_mar_slots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_slot RECORD;
  v_doctor_user_id uuid;
  v_count int := 0;
  v_cutoff timestamptz;
  v_slot_ts timestamptz;
BEGIN
  -- For each pending MAR slot where scheduled time + 2hrs has passed today
  FOR v_slot IN
    SELECT
      m.id,
      m.drug_name,
      m.dose,
      m.scheduled_date,
      m.scheduled_time,
      m.hospital_id,
      m.admission_id,
      m.patient_id,
      p.full_name AS patient_name,
      ia.admitting_doctor_id,
      pr.user_id AS doctor_user_id
    FROM ipd_mar m
    JOIN patients p ON p.id = m.patient_id
    JOIN ipd_admissions ia ON ia.id = m.admission_id
    JOIN practitioners pr ON pr.id = ia.admitting_doctor_id
    WHERE m.status = 'pending'
      AND m.scheduled_date = CURRENT_DATE
      -- slot time + 2 hours < now (IST = UTC+5:30)
      AND (m.scheduled_date + m.scheduled_time) AT TIME ZONE 'Asia/Kolkata'
          + INTERVAL '2 hours' < now()
      -- Don't re-notify — check no existing overdue notification for this slot
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.reference_type = 'ipd_mar'
          AND n.reference_id = m.id
          AND n.category = 'mar_overdue'
      )
  LOOP
    PERFORM notify_clinical_event(
      v_slot.hospital_id,
      v_slot.doctor_user_id,
      'doctor',
      'IPD',
      'mar_overdue',
      'high',
      '⚠️ Missed dose — ' || v_slot.patient_name,
      v_slot.drug_name || ' ' || COALESCE(v_slot.dose, '') ||
        ' due at ' ||
        TO_CHAR((v_slot.scheduled_date + v_slot.scheduled_time)
          AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') ||
        ' has not been administered (>2 hrs overdue).',
      'ipd_mar',
      v_slot.id,
      '/app/ipd/admission/' || v_slot.admission_id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Trigger: fire check whenever a MAR slot is inserted or updated
CREATE OR REPLACE FUNCTION public.trg_mar_overdue_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Only care about pending slots
  IF NEW.status = 'pending' THEN
    PERFORM notify_overdue_mar_slots();
  END IF;
  RETURN NEW;
END;
$function$;

-- Drop + recreate trigger on ipd_mar
DROP TRIGGER IF EXISTS mar_overdue_check_trigger ON ipd_mar;
CREATE TRIGGER mar_overdue_check_trigger
  AFTER INSERT OR UPDATE ON ipd_mar
  FOR EACH ROW EXECUTE FUNCTION trg_mar_overdue_check();

NOTIFY pgrst, 'reload schema';
