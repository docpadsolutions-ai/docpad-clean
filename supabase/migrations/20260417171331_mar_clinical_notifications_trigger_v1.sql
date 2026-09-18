-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417171331.

CREATE OR REPLACE FUNCTION fn_mar_clinical_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_doctor_id       uuid;
  v_nurse_name      text;
  v_patient_name    text;
  v_hospital_id     uuid;
  v_notif_type      text;
  v_title           text;
  v_body            text;
  v_priority        text;
BEGIN
  -- Only act on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get context
  SELECT a.admitting_doctor_id, p.full_name, a.hospital_id
    INTO v_doctor_id, v_patient_name, v_hospital_id
    FROM ipd_admissions a
    JOIN patients p ON p.id = NEW.patient_id
    WHERE a.id = NEW.admission_id;

  SELECT full_name INTO v_nurse_name
    FROM practitioners WHERE id = NEW.administered_by;

  -- Build notification per status
  IF NEW.status = 'omitted' THEN
    v_notif_type := 'mar_omitted';
    v_title      := '⚠️ Dose Omitted — ' || v_patient_name;
    v_body       := NEW.drug_name || ' ' || COALESCE(NEW.dose, '') ||
                    ' (scheduled ' || to_char(NEW.scheduled_time, 'HH12:MI AM') || ') was omitted' ||
                    CASE WHEN NEW.omission_reason IS NOT NULL
                         THEN '. Reason: ' || NEW.omission_reason ELSE '' END ||
                    '. Nurse: ' || COALESCE(v_nurse_name, 'unknown');
    v_priority   := 'high';

  ELSIF NEW.status = 'held' THEN
    v_notif_type := 'mar_held';
    v_title      := '⏸ Dose Held — ' || v_patient_name;
    v_body       := NEW.drug_name || ' held at ' || to_char(NEW.scheduled_time, 'HH12:MI AM') ||
                    CASE WHEN NEW.hold_reason IS NOT NULL
                         THEN '. Reason: ' || NEW.hold_reason ELSE '' END;
    v_priority   := 'high';

  ELSIF NEW.status = 'given' AND NEW.adverse_event = true THEN
    v_notif_type := 'mar_adverse_event';
    v_title      := '🚨 Adverse Event — ' || v_patient_name;
    v_body       := NEW.drug_name || ' given but adverse event flagged. Notes: ' ||
                    COALESCE(NEW.adverse_event_notes, 'none');
    v_priority   := 'urgent';

  ELSIF NEW.status = 'overdue' THEN
    v_notif_type := 'mar_overdue';
    v_title      := '🕐 Missed Dose — ' || v_patient_name;
    v_body       := NEW.drug_name || ' ' || COALESCE(NEW.dose, '') ||
                    ' due at ' || to_char(NEW.scheduled_time, 'HH12:MI AM') ||
                    ' has not been administered (>2 hrs overdue)';
    v_priority   := 'high';

  ELSE
    RETURN NEW; -- given (no adverse), pending — no notification needed
  END IF;

  -- Insert notification for the attending doctor
  IF v_doctor_id IS NOT NULL THEN
    INSERT INTO notifications (
      hospital_id, recipient_id, sender_id,
      type, title, body,
      priority, context, category,
      recipient_role, reference_type, reference_id,
      data, is_read, created_at
    ) VALUES (
      v_hospital_id, v_doctor_id, NEW.administered_by,
      v_notif_type, v_title, v_body,
      v_priority, 'IPD', 'medication',
      'doctor', 'ipd_mar', NEW.id,
      jsonb_build_object(
        'admission_id', NEW.admission_id,
        'patient_id',   NEW.patient_id,
        'drug_name',    NEW.drug_name,
        'scheduled_time', NEW.scheduled_time,
        'scheduled_date', NEW.scheduled_date,
        'status',       NEW.status
      ),
      false, now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mar_clinical_notifications ON ipd_mar;

CREATE TRIGGER trg_mar_clinical_notifications
  AFTER UPDATE ON ipd_mar
  FOR EACH ROW
  EXECUTE FUNCTION fn_mar_clinical_notifications();

NOTIFY pgrst, 'reload schema';
