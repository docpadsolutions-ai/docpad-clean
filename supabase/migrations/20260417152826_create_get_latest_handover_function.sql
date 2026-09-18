-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417152826.

CREATE OR REPLACE FUNCTION public.get_latest_handover(
  p_admission_id uuid,
  p_shift_date date,
  p_shift_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', h.id,
    'shift_date', h.shift_date,
    'shift_type', h.shift_type,
    'handover_time', h.handover_time,
    'situation', h.situation,
    'background', h.background,
    'assessment', h.assessment,
    'recommendation', h.recommendation,
    'current_vitals_json', h.current_vitals_json,
    'pending_tasks', h.pending_tasks,
    'pending_investigations', h.pending_investigations,
    'iv_access', h.iv_access,
    'drain_status', h.drain_status,
    'pain_score', h.pain_score,
    'mobility_status', h.mobility_status,
    'special_concerns', h.special_concerns,
    'is_signed_by_receiver', h.is_signed_by_receiver,
    'receiver_signature_at', h.receiver_signature_at,
    'handover_by', h.handover_by,
    'handover_to', h.handover_to
  )
  INTO v_result
  FROM ipd_shift_handovers h
  WHERE h.admission_id = p_admission_id
    AND h.shift_date = p_shift_date
    AND lower(trim(h.shift_type)) = lower(trim(p_shift_type))
    AND h.hospital_id IN (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    )
  ORDER BY h.created_at DESC
  LIMIT 1;

  RETURN v_result; -- returns NULL if no handover exists, frontend handles gracefully
END;
$function$;

NOTIFY pgrst, 'reload schema';
