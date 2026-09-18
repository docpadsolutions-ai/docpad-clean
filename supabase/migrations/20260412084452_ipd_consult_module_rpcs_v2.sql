-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412084452.

-- ============================================================
-- SMART CONSULT MODULE — Full RPC Suite v2
-- FHIR R4 ServiceRequest | NABH COP.5
-- ============================================================

-- 1. REQUEST CONSULT
CREATE OR REPLACE FUNCTION request_consult(
  p_admission_id UUID DEFAULT NULL,
  p_patient_id UUID DEFAULT NULL,
  p_consulting_doctor_id UUID DEFAULT NULL,
  p_consulting_department_id UUID DEFAULT NULL,
  p_consulting_specialty TEXT DEFAULT NULL,
  p_reason_for_consult TEXT DEFAULT NULL,
  p_urgency TEXT DEFAULT 'routine',
  p_progress_note_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
  v_requesting_practitioner_id UUID;
  v_requesting_user_id UUID;
  v_consult_id UUID;
  v_patient_name TEXT;
  v_requester_name TEXT;
  v_fhir JSONB;
BEGIN
  SELECT pr.hospital_id, pr.id, pr.user_id, pr.full_name
  INTO v_hospital_id, v_requesting_practitioner_id, v_requesting_user_id, v_requester_name
  FROM practitioners pr WHERE pr.user_id = auth.uid() LIMIT 1;

  IF v_hospital_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Practitioner not found');
  END IF;

  SELECT full_name INTO v_patient_name FROM patients WHERE id = p_patient_id;

  -- FHIR R4 ServiceRequest
  v_fhir := jsonb_build_object(
    'resourceType', 'ServiceRequest',
    'status', 'active',
    'intent', 'order',
    'category', jsonb_build_array(jsonb_build_object(
      'coding', jsonb_build_array(jsonb_build_object(
        'system', 'http://snomed.info/sct',
        'code', '11429006',
        'display', 'Consultation'
      ))
    )),
    'priority', CASE p_urgency WHEN 'stat' THEN 'stat' WHEN 'urgent' THEN 'urgent' ELSE 'routine' END,
    'subject', jsonb_build_object('reference', 'Patient/' || p_patient_id),
    'requester', jsonb_build_object('reference', 'Practitioner/' || v_requesting_practitioner_id),
    'reasonCode', jsonb_build_array(jsonb_build_object('text', p_reason_for_consult)),
    'authoredOn', now()
  );

  INSERT INTO ipd_consult_requests (
    hospital_id, admission_id, patient_id,
    requesting_doctor_id, consulting_doctor_id,
    consulting_department_id, consulting_specialty,
    reason_for_consult, urgency, status,
    progress_note_id, fhir_json
  ) VALUES (
    v_hospital_id, p_admission_id, p_patient_id,
    v_requesting_practitioner_id, p_consulting_doctor_id,
    p_consulting_department_id, p_consulting_specialty,
    p_reason_for_consult, p_urgency, 'requested',
    p_progress_note_id, v_fhir
  ) RETURNING id INTO v_consult_id;

  -- Notify consulting doctor
  IF p_consulting_doctor_id IS NOT NULL THEN
    INSERT INTO notifications (
      hospital_id, recipient_id, sender_id, type, title, body, data, is_read, priority, action_url
    )
    SELECT
      v_hospital_id,
      pr.user_id,
      v_requesting_user_id,
      'consult_request',
      CASE p_urgency
        WHEN 'stat' THEN '🚨 STAT Consult — ' || COALESCE(v_patient_name, 'Patient')
        WHEN 'urgent' THEN '⚡ Urgent Consult — ' || COALESCE(v_patient_name, 'Patient')
        ELSE '📋 Consult Request — ' || COALESCE(v_patient_name, 'Patient')
      END,
      'From Dr. ' || v_requester_name || ': ' || COALESCE(p_reason_for_consult, 'See patient details'),
      jsonb_build_object(
        'consult_id', v_consult_id,
        'admission_id', p_admission_id,
        'patient_id', p_patient_id,
        'urgency', p_urgency
      ),
      false,
      CASE p_urgency WHEN 'stat' THEN 'high' WHEN 'urgent' THEN 'high' ELSE 'normal' END,
      '/app/ipd/' || p_admission_id
    FROM practitioners pr
    WHERE pr.id = p_consulting_doctor_id AND pr.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('success', true, 'consult_id', v_consult_id);
END;
$$;

-- 2. GET CONSULTS FOR ADMISSION (sidebar)
DROP FUNCTION IF EXISTS get_admission_consults(UUID);
CREATE OR REPLACE FUNCTION get_admission_consults(p_admission_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  status TEXT,
  urgency TEXT,
  reason_for_consult TEXT,
  consult_notes TEXT,
  requested_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  requesting_doctor_name TEXT,
  requesting_doctor_specialty TEXT,
  consulting_doctor_name TEXT,
  consulting_doctor_specialty TEXT,
  consulting_department_name TEXT,
  consulting_specialty TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    cr.id,
    cr.status,
    cr.urgency,
    cr.reason_for_consult,
    cr.consult_notes,
    cr.requested_at,
    cr.responded_at,
    req.full_name,
    COALESCE(req.primary_specialty, req.specialty, req.specialization),
    con.full_name,
    COALESCE(con.primary_specialty, con.specialty, con.specialization),
    d.name,
    cr.consulting_specialty
  FROM ipd_consult_requests cr
  LEFT JOIN practitioners req ON req.id = cr.requesting_doctor_id
  LEFT JOIN practitioners con ON con.id = cr.consulting_doctor_id
  LEFT JOIN departments d ON d.id = cr.consulting_department_id
  WHERE cr.admission_id = p_admission_id
  ORDER BY
    CASE cr.urgency WHEN 'stat' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
    cr.requested_at DESC;
END;
$$;

-- 3. MY PENDING CONSULTS (consulting doctor inbox)
DROP FUNCTION IF EXISTS get_my_pending_consults();
CREATE OR REPLACE FUNCTION get_my_pending_consults()
RETURNS TABLE (
  id UUID,
  admission_id UUID,
  patient_id UUID,
  patient_name TEXT,
  patient_age TEXT,
  bed_number TEXT,
  ward_name TEXT,
  status TEXT,
  urgency TEXT,
  reason_for_consult TEXT,
  requesting_doctor_name TEXT,
  requested_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_practitioner_id UUID;
BEGIN
  SELECT pr.id INTO v_practitioner_id FROM practitioners pr WHERE pr.user_id = auth.uid() LIMIT 1;

  RETURN QUERY
  SELECT
    cr.id,
    cr.admission_id,
    cr.patient_id,
    p.full_name,
    CASE WHEN p.date_of_birth IS NOT NULL
      THEN EXTRACT(YEAR FROM age(p.date_of_birth::date))::TEXT || 'y'
      ELSE 'N/A'
    END,
    b.bed_number,
    w.name,
    cr.status,
    cr.urgency,
    cr.reason_for_consult,
    req.full_name,
    cr.requested_at
  FROM ipd_consult_requests cr
  JOIN patients p ON p.id = cr.patient_id
  LEFT JOIN ipd_admissions adm ON adm.id = cr.admission_id
  LEFT JOIN ipd_beds b ON b.id = adm.bed_id
  LEFT JOIN ipd_wards w ON w.id = b.ward_id
  LEFT JOIN practitioners req ON req.id = cr.requesting_doctor_id
  WHERE cr.consulting_doctor_id = v_practitioner_id
    AND cr.status IN ('requested', 'accepted')
  ORDER BY
    CASE cr.urgency WHEN 'stat' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
    cr.requested_at ASC;
END;
$$;

-- 4. RESPOND TO CONSULT
CREATE OR REPLACE FUNCTION respond_to_consult(
  p_consult_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_consult_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_practitioner_id UUID;
  v_user_id UUID;
  v_doctor_name TEXT;
  v_consult ipd_consult_requests%ROWTYPE;
BEGIN
  SELECT pr.id, pr.user_id, pr.full_name
  INTO v_practitioner_id, v_user_id, v_doctor_name
  FROM practitioners pr WHERE pr.user_id = auth.uid() LIMIT 1;

  SELECT * INTO v_consult FROM ipd_consult_requests WHERE id = p_consult_id;

  IF v_consult.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consult not found');
  END IF;

  IF v_consult.consulting_doctor_id IS DISTINCT FROM v_practitioner_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE ipd_consult_requests SET
    status = COALESCE(p_status, status),
    consult_notes = COALESCE(p_consult_notes, consult_notes),
    responded_at = CASE WHEN p_status IN ('responded', 'accepted') THEN now() ELSE responded_at END,
    updated_at = now()
  WHERE id = p_consult_id;

  -- Notify requesting doctor on response
  IF p_status = 'responded' THEN
    INSERT INTO notifications (
      hospital_id, recipient_id, sender_id, type, title, body, data, is_read, priority, action_url
    )
    SELECT
      v_consult.hospital_id,
      req.user_id,
      v_user_id,
      'consult_response',
      '✅ Consult Response from Dr. ' || v_doctor_name,
      COALESCE(p_consult_notes, 'Consult completed — see patient chart.'),
      jsonb_build_object(
        'consult_id', p_consult_id,
        'admission_id', v_consult.admission_id
      ),
      false,
      'normal',
      '/app/ipd/' || v_consult.admission_id
    FROM practitioners req
    WHERE req.id = v_consult.requesting_doctor_id AND req.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5. GET DOCTORS BY DEPARTMENT (for modal)
DROP FUNCTION IF EXISTS get_doctors_by_department(UUID);
CREATE OR REPLACE FUNCTION get_doctors_by_department(p_department_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  specialty TEXT,
  designation TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
BEGIN
  SELECT pr.hospital_id INTO v_hospital_id FROM practitioners pr WHERE pr.user_id = auth.uid() LIMIT 1;

  RETURN QUERY
  SELECT
    pr.id,
    pr.full_name,
    COALESCE(pr.primary_specialty, pr.specialty, pr.specialization, 'General'),
    COALESCE(pr.designation, pr.current_position, '')
  FROM practitioners pr
  WHERE pr.hospital_id = v_hospital_id
    AND pr.is_active = true
    AND LOWER(COALESCE(pr.user_role, pr.role, '')) IN ('doctor', 'consultant')
    AND (p_department_id IS NULL OR pr.primary_department_id = p_department_id)
  ORDER BY pr.full_name;
END;
$$;

-- 6. MARK NOTIFICATION READ
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE notifications SET is_read = true, read_at = now()
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

-- 7. GET MY UNREAD NOTIFICATIONS
DROP FUNCTION IF EXISTS get_my_notifications(INT);
CREATE OR REPLACE FUNCTION get_my_notifications(p_limit INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  data JSONB,
  priority TEXT,
  is_read BOOLEAN,
  action_url TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT n.id, n.type, n.title, n.body, n.data, n.priority, n.is_read, n.action_url, n.created_at
  FROM notifications n
  WHERE n.recipient_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT p_limit;
END;
$$;

-- RLS for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recipients see own notifications" ON notifications;
CREATE POLICY "Recipients see own notifications" ON notifications
  FOR SELECT USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Hospital members insert notifications" ON notifications;
CREATE POLICY "Hospital members insert notifications" ON notifications
  FOR INSERT WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Recipients update own notifications" ON notifications;
CREATE POLICY "Recipients update own notifications" ON notifications
  FOR UPDATE USING (recipient_id = auth.uid());

NOTIFY pgrst, 'reload schema';
