-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408095957.

-- ABDM Audit Logging per DPDPA 2023 §8
CREATE OR REPLACE FUNCTION log_abdm_access(
  p_event_type TEXT,
  p_patient_id UUID,
  p_user_id UUID,
  p_consent_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID AS $$
BEGIN
  INSERT INTO audit_logs (
    hospital_id,
    user_id,
    practitioner_id,
    action,
    resource_type,
    resource_id,
    old_values,
    new_values
  ) VALUES (
    (SELECT hospital_id FROM patients WHERE id = p_patient_id),
    p_user_id,
    (SELECT id FROM practitioners WHERE user_id = p_user_id LIMIT 1),
    p_event_type,
    'abdm_data_transfer',
    CASE WHEN p_consent_id IS NOT NULL THEN p_consent_id::uuid ELSE NULL END,
    NULL,
    jsonb_build_object(
      'patient_id', p_patient_id,
      'timestamp', now(),
      'metadata', p_metadata
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_abdm_access IS 'DPDPA 2023 §8 compliant audit trail for ABDM data access events';
