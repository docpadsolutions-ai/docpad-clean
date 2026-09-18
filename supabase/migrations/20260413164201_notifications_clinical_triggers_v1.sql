-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413164201.

-- ============================================================
-- HELPER: insert a notification row
-- ============================================================
CREATE OR REPLACE FUNCTION notify_clinical_event(
  p_hospital_id   UUID,
  p_recipient_id  UUID,         -- NULL = broadcast to role
  p_recipient_role TEXT,
  p_context       TEXT,         -- 'OPD' | 'IPD'
  p_category      TEXT,
  p_priority      TEXT,
  p_title         TEXT,
  p_body          TEXT,
  p_reference_type TEXT,
  p_reference_id  UUID,
  p_action_url    TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (
    hospital_id, recipient_id, recipient_role,
    context, category, priority,
    title, body,
    reference_type, reference_id,
    action_url,
    expires_at
  ) VALUES (
    p_hospital_id, p_recipient_id, p_recipient_role,
    p_context, p_category, p_priority,
    p_title, p_body,
    p_reference_type, p_reference_id,
    p_action_url,
    now() + INTERVAL '7 days'
  );
END;
$$;

-- ============================================================
-- TRIGGER 1: IPD critical vitals alert
-- Fires when a new vitals row has SpO2 < 90 or RR < 10 or > 30
-- ============================================================
CREATE OR REPLACE FUNCTION trg_ipd_vitals_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_patient_name TEXT;
  v_bed_no TEXT;
  v_doctor_user_id UUID;
BEGIN
  -- Only fire on critical values
  IF NOT (
    (NEW.spo2 IS NOT NULL AND NEW.spo2 < 90) OR
    (NEW.respiratory_rate IS NOT NULL AND (NEW.respiratory_rate < 10 OR NEW.respiratory_rate > 30)) OR
    (NEW.heart_rate IS NOT NULL AND (NEW.heart_rate < 40 OR NEW.heart_rate > 150))
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_patient_name
  FROM patients p
  JOIN ipd_admissions a ON a.patient_id = p.id
  WHERE a.id = NEW.admission_id;

  SELECT b.bed_number INTO v_bed_no
  FROM ipd_beds b
  JOIN ipd_admissions a ON a.bed_id = b.id
  WHERE a.id = NEW.admission_id;

  -- Notify the treating doctor
  SELECT pr.user_id INTO v_doctor_user_id
  FROM ipd_admissions a
  JOIN practitioners pr ON pr.id = a.doctor_id
  WHERE a.id = NEW.admission_id;

  PERFORM notify_clinical_event(
    NEW.hospital_id,
    v_doctor_user_id,
    'doctor',
    'IPD',
    'vitals_alert',
    'critical',
    'Critical vitals — ' || COALESCE(v_patient_name, 'Patient') || ' (' || COALESCE(v_bed_no, '') || ')',
    CASE
      WHEN NEW.spo2 IS NOT NULL AND NEW.spo2 < 90 THEN 'SpO₂ dropped to ' || NEW.spo2 || '%'
      WHEN NEW.heart_rate IS NOT NULL AND NEW.heart_rate > 150 THEN 'Heart rate ' || NEW.heart_rate || ' bpm'
      WHEN NEW.heart_rate IS NOT NULL AND NEW.heart_rate < 40 THEN 'Bradycardia — HR ' || NEW.heart_rate || ' bpm'
      ELSE 'Respiratory rate ' || NEW.respiratory_rate || ' /min'
    END,
    'ipd_admission',
    NEW.admission_id,
    '/app/ipd/admission/' || NEW.admission_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_ipd_vitals_alert ON ipd_vitals;
CREATE TRIGGER trig_ipd_vitals_alert
  AFTER INSERT ON ipd_vitals
  FOR EACH ROW EXECUTE FUNCTION trg_ipd_vitals_alert();

-- ============================================================
-- TRIGGER 2: IPD investigation result released
-- ============================================================
CREATE OR REPLACE FUNCTION trg_ipd_investigation_result()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_patient_name TEXT;
  v_test_name TEXT;
  v_doctor_user_id UUID;
  v_hospital_id UUID;
  v_admission_id UUID;
BEGIN
  -- Only fire when status changes to 'completed'
  IF NEW.status <> 'completed' OR (OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT io.admission_id, io.hospital_id INTO v_admission_id, v_hospital_id
  FROM ipd_investigation_orders io
  WHERE io.id = NEW.order_id;

  SELECT p.full_name INTO v_patient_name
  FROM patients p
  JOIN ipd_admissions a ON a.patient_id = p.id
  WHERE a.id = v_admission_id;

  SELECT tc.test_name INTO v_test_name
  FROM test_catalogue tc
  WHERE tc.id = NEW.test_id;

  SELECT pr.user_id INTO v_doctor_user_id
  FROM ipd_admissions a
  JOIN practitioners pr ON pr.id = a.doctor_id
  WHERE a.id = v_admission_id;

  PERFORM notify_clinical_event(
    v_hospital_id,
    v_doctor_user_id,
    'doctor',
    'IPD',
    'lab_result',
    CASE WHEN NEW.is_critical THEN 'critical' ELSE 'normal' END,
    CASE WHEN NEW.is_critical
      THEN 'Critical result — ' || COALESCE(v_test_name, 'Lab test')
      ELSE 'Result ready — ' || COALESCE(v_test_name, 'Lab test')
    END,
    COALESCE(v_patient_name, 'Patient') || ' · Review and sign off',
    'ipd_admission',
    v_admission_id,
    '/app/ipd/admission/' || v_admission_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_ipd_investigation_result ON lab_result_entries;
CREATE TRIGGER trig_ipd_investigation_result
  AFTER INSERT OR UPDATE ON lab_result_entries
  FOR EACH ROW EXECUTE FUNCTION trg_ipd_investigation_result();

-- ============================================================
-- TRIGGER 3: IPD discharge pending sign-off
-- Fires when discharge_summary status → 'pending_doctor_signoff'
-- ============================================================
CREATE OR REPLACE FUNCTION trg_ipd_discharge_signoff()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_patient_name TEXT;
  v_doctor_user_id UUID;
BEGIN
  IF NEW.status <> 'pending_doctor_signoff' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending_doctor_signoff' THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_patient_name
  FROM patients p
  JOIN ipd_admissions a ON a.patient_id = p.id
  WHERE a.id = NEW.admission_id;

  SELECT pr.user_id INTO v_doctor_user_id
  FROM ipd_admissions a
  JOIN practitioners pr ON pr.id = a.doctor_id
  WHERE a.id = NEW.admission_id;

  PERFORM notify_clinical_event(
    NEW.hospital_id,
    v_doctor_user_id,
    'doctor',
    'IPD',
    'discharge',
    'high',
    'Discharge summary pending — ' || COALESCE(v_patient_name, 'Patient'),
    'Summary compiled and awaiting your sign-off',
    'ipd_admission',
    NEW.admission_id,
    '/app/ipd/admission/' || NEW.admission_id || '/discharge'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_ipd_discharge_signoff ON ipd_discharge_summaries;
CREATE TRIGGER trig_ipd_discharge_signoff
  AFTER INSERT OR UPDATE ON ipd_discharge_summaries
  FOR EACH ROW EXECUTE FUNCTION trg_ipd_discharge_signoff();

-- ============================================================
-- TRIGGER 4: OPD investigation result released (paid + completed)
-- ============================================================
CREATE OR REPLACE FUNCTION trg_opd_investigation_result()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_patient_name TEXT;
  v_test_name TEXT;
  v_doctor_user_id UUID;
  v_hospital_id UUID;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name, p.hospital_id INTO v_patient_name, v_hospital_id
  FROM patients p
  JOIN investigations i ON i.patient_id = p.id
  WHERE i.id = NEW.investigation_id;

  SELECT tc.test_name INTO v_test_name
  FROM test_catalogue tc
  WHERE tc.id = NEW.test_id;

  -- Notify the ordering doctor
  SELECT pr.user_id INTO v_doctor_user_id
  FROM investigations i
  JOIN practitioners pr ON pr.id = i.ordered_by
  WHERE i.id = NEW.investigation_id;

  PERFORM notify_clinical_event(
    v_hospital_id,
    v_doctor_user_id,
    'doctor',
    'OPD',
    'lab_result',
    CASE WHEN NEW.is_critical THEN 'critical' ELSE 'normal' END,
    CASE WHEN NEW.is_critical
      THEN '⚠ Critical result — ' || COALESCE(v_test_name, 'Lab test')
      ELSE 'Result ready — ' || COALESCE(v_test_name, 'Lab test')
    END,
    COALESCE(v_patient_name, 'Patient') || ' · Available for review',
    'investigation_result',
    NEW.id,
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_opd_investigation_result ON investigation_results;
CREATE TRIGGER trig_opd_investigation_result
  AFTER INSERT OR UPDATE ON investigation_results
  FOR EACH ROW EXECUTE FUNCTION trg_opd_investigation_result();

-- ============================================================
-- TRIGGER 5: OT schedule change — notify doctor
-- ============================================================
CREATE OR REPLACE FUNCTION trg_ot_schedule_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_patient_name TEXT;
  v_doctor_user_id UUID;
BEGIN
  -- Only fire on time/room changes
  IF NEW.scheduled_start = OLD.scheduled_start AND NEW.ot_room_id = OLD.ot_room_id THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_patient_name
  FROM patients p WHERE p.id = NEW.patient_id;

  SELECT pr.user_id INTO v_doctor_user_id
  FROM practitioners pr WHERE pr.id = NEW.surgeon_id;

  PERFORM notify_clinical_event(
    NEW.hospital_id,
    v_doctor_user_id,
    'doctor',
    'IPD',
    'ot_schedule',
    'high',
    'OT schedule updated — ' || COALESCE(v_patient_name, 'Patient'),
    'Surgery rescheduled to ' || to_char(NEW.scheduled_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' — confirm with anaesthesia',
    'ot_surgery',
    NEW.id,
    '/app/ipd/ot/' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_ot_schedule_change ON ot_surgeries;
CREATE TRIGGER trig_ot_schedule_change
  AFTER UPDATE ON ot_surgeries
  FOR EACH ROW EXECUTE FUNCTION trg_ot_schedule_change();
