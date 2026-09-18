-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414132000.

-- =====================================================================
-- SPRINT 4 RPCs
-- =====================================================================

-- RPC 1: get_pending_results_summary
-- Returns counts by status for the pending results panel (fast, single call)
DROP FUNCTION IF EXISTS get_pending_results_summary(UUID);
CREATE OR REPLACE FUNCTION get_pending_results_summary(p_hospital_id UUID)
RETURNS TABLE (
  status_bucket TEXT,
  count BIGINT,
  oldest_ordered_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    CASE
      WHEN result_status IN ('pending', 'sample_collected', 'processing')
           AND (expected_at IS NULL OR expected_at >= now()) THEN 'pending'
      WHEN result_status IN ('pending', 'sample_collected', 'processing')
           AND expected_at < now()
           AND expected_at >= now() - INTERVAL '3 days' THEN 'late'
      WHEN result_status IN ('pending', 'sample_collected', 'processing')
           AND expected_at < now() - INTERVAL '3 days' THEN 'lost'
      WHEN result_status = 'resulted' AND acknowledged_at IS NULL THEN 'needs_review'
      ELSE 'other'
    END AS status_bucket,
    COUNT(*) AS count,
    MIN(ordered_at) AS oldest_ordered_at
  FROM investigations
  WHERE hospital_id = p_hospital_id
    AND status = 'active'
  GROUP BY 1
  HAVING CASE
    WHEN result_status IN ('pending', 'sample_collected', 'processing')
         AND (expected_at IS NULL OR expected_at >= now()) THEN 'pending'
    WHEN result_status IN ('pending', 'sample_collected', 'processing')
         AND expected_at < now()
         AND expected_at >= now() - INTERVAL '3 days' THEN 'late'
    WHEN result_status IN ('pending', 'sample_collected', 'processing')
         AND expected_at < now() - INTERVAL '3 days' THEN 'lost'
    WHEN result_status = 'resulted' AND acknowledged_at IS NULL THEN 'needs_review'
    ELSE 'other'
  END != 'other';
$$;

-- RPC 2: get_pending_results_detail
-- Returns full list for the panel with patient info joined
DROP FUNCTION IF EXISTS get_pending_results_detail(UUID);
CREATE OR REPLACE FUNCTION get_pending_results_detail(p_hospital_id UUID)
RETURNS TABLE (
  id UUID,
  patient_id UUID,
  patient_name TEXT,
  test_name TEXT,
  test_category TEXT,
  result_status TEXT,
  result_severity TEXT,
  priority TEXT,
  ordered_at TIMESTAMPTZ,
  expected_at TIMESTAMPTZ,
  hours_overdue NUMERIC,
  urgency_bucket TEXT,
  acknowledged_at TIMESTAMPTZ,
  doctor_id UUID
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    i.id,
    i.patient_id,
    p.full_name AS patient_name,
    i.test_name,
    i.test_category,
    i.result_status,
    i.result_severity,
    i.priority,
    i.ordered_at,
    i.expected_at,
    CASE 
      WHEN i.expected_at IS NOT NULL AND i.expected_at < now()
      THEN EXTRACT(EPOCH FROM (now() - i.expected_at)) / 3600
      ELSE NULL
    END AS hours_overdue,
    CASE
      WHEN i.result_status IN ('pending', 'sample_collected', 'processing')
           AND i.expected_at IS NOT NULL AND i.expected_at < now() - INTERVAL '3 days' THEN 'lost'
      WHEN i.result_status IN ('pending', 'sample_collected', 'processing')
           AND i.expected_at IS NOT NULL AND i.expected_at < now() THEN 'late'
      WHEN i.result_status IN ('pending', 'sample_collected', 'processing') THEN 'pending'
      WHEN i.result_status = 'resulted' AND i.acknowledged_at IS NULL THEN 'needs_review'
      ELSE 'normal'
    END AS urgency_bucket,
    i.acknowledged_at,
    i.doctor_id
  FROM investigations i
  JOIN patients p ON p.id = i.patient_id
  WHERE i.hospital_id = p_hospital_id
    AND i.status = 'active'
    AND (
      i.result_status IN ('pending', 'sample_collected', 'processing')
      OR (i.result_status = 'resulted' AND i.acknowledged_at IS NULL)
    )
  ORDER BY
    CASE
      WHEN i.result_status IN ('pending', 'sample_collected', 'processing')
           AND i.expected_at < now() - INTERVAL '3 days' THEN 1  -- lost first
      WHEN i.result_status IN ('pending', 'sample_collected', 'processing')
           AND i.expected_at < now() THEN 2                      -- late second
      WHEN i.result_status = 'resulted' AND i.acknowledged_at IS NULL THEN 3  -- needs review
      ELSE 4
    END,
    i.expected_at ASC NULLS LAST;
$$;

-- RPC 3: acknowledge_investigation_result
-- Marks result acknowledged + writes audit log atomically
DROP FUNCTION IF EXISTS acknowledge_investigation_result(UUID, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION acknowledge_investigation_result(
  p_investigation_id UUID,
  p_hospital_id UUID,
  p_action_taken TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_practitioner_id UUID;
  v_patient_id UUID;
  v_severity TEXT;
  v_ack_id UUID;
BEGIN
  -- Get practitioner id from auth
  SELECT id INTO v_practitioner_id FROM practitioners WHERE user_id = auth.uid();
  IF v_practitioner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Practitioner not found');
  END IF;

  -- Get investigation details + validate hospital scope
  SELECT patient_id, result_severity 
  INTO v_patient_id, v_severity
  FROM investigations
  WHERE id = p_investigation_id AND hospital_id = p_hospital_id;

  IF v_patient_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Investigation not found or not in scope');
  END IF;

  -- Mark acknowledged on investigations
  UPDATE investigations
  SET acknowledged_at = now(), acknowledged_by = v_practitioner_id
  WHERE id = p_investigation_id;

  -- Write audit log
  INSERT INTO investigation_acknowledgements (
    investigation_id, patient_id, hospital_id,
    acknowledged_by, acknowledged_at,
    action_taken, notes, result_severity_at_ack,
    fhir_task_json
  ) VALUES (
    p_investigation_id, v_patient_id, p_hospital_id,
    v_practitioner_id, now(),
    p_action_taken, p_notes, v_severity,
    jsonb_build_object(
      'resourceType', 'Task',
      'status', 'completed',
      'intent', 'order',
      'code', jsonb_build_object(
        'coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/task-code',
          'code', 'review',
          'display', 'Review result'
        ))
      ),
      'for', jsonb_build_object('reference', 'Patient/' || v_patient_id),
      'focus', jsonb_build_object('reference', 'DiagnosticReport/' || p_investigation_id),
      'authoredOn', now(),
      'lastModified', now(),
      'owner', jsonb_build_object('reference', 'Practitioner/' || v_practitioner_id)
    )
  ) RETURNING id INTO v_ack_id;

  RETURN jsonb_build_object('success', true, 'acknowledgement_id', v_ack_id);
END;
$$;

-- RPC 4: get_similar_patient_names
-- Returns patients with similar names within the hospital (for ⚠️ badge logic)
DROP FUNCTION IF EXISTS get_similar_patient_names(UUID);
CREATE OR REPLACE FUNCTION get_similar_patient_names(p_hospital_id UUID)
RETURNS TABLE (
  patient_id UUID,
  full_name TEXT,
  similar_to_patient_id UUID,
  similar_to_name TEXT,
  similarity_score NUMERIC
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT 
    a.id AS patient_id,
    a.full_name,
    b.id AS similar_to_patient_id,
    b.full_name AS similar_to_name,
    ROUND(similarity(a.full_name, b.full_name)::NUMERIC, 3) AS similarity_score
  FROM patients a
  JOIN patients b ON a.id < b.id AND a.hospital_id = b.hospital_id
  WHERE a.hospital_id = p_hospital_id
    AND similarity(a.full_name, b.full_name) > 0.6;
$$;

-- RPC 5: update_investigation_severity
-- Called after OCR/lab result entry to set the severity tier
DROP FUNCTION IF EXISTS update_investigation_severity(UUID, TEXT);
CREATE OR REPLACE FUNCTION update_investigation_severity(
  p_investigation_id UUID,
  p_severity TEXT  -- 'critical' | 'high' | 'abnormal' | 'normal'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE investigations
  SET result_severity = p_severity, updated_at = now()
  WHERE id = p_investigation_id;
END;
$$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
