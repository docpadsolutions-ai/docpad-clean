-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417154219.

CREATE OR REPLACE FUNCTION public.mark_mar_dose(
  p_mar_id uuid,
  p_status text,
  p_actual_dose text DEFAULT NULL,
  p_actual_route text DEFAULT NULL,
  p_adverse_event boolean DEFAULT false,
  p_hold_reason text DEFAULT NULL,
  p_iv_site text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_practitioner_id uuid;
  v_hospital_id uuid;
BEGIN
  SELECT id, hospital_id INTO v_practitioner_id, v_hospital_id
  FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  IF v_practitioner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated as practitioner');
  END IF;

  -- Validate status
  IF p_status NOT IN ('given', 'held', 'omitted', 'refused', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid status: ' || p_status);
  END IF;

  UPDATE ipd_mar SET
    status            = p_status,
    administered_at   = CASE WHEN p_status = 'given' THEN now() ELSE NULL END,
    administered_by   = CASE WHEN p_status = 'given' THEN v_practitioner_id ELSE NULL END,
    actual_dose_given = COALESCE(p_actual_dose, dose),
    actual_route      = COALESCE(p_actual_route, route),
    adverse_event     = COALESCE(p_adverse_event, false),
    adverse_event_notes = CASE WHEN p_adverse_event THEN p_notes ELSE NULL END,
    hold_reason       = p_hold_reason,
    iv_site           = p_iv_site,
    notes             = CASE WHEN NOT p_adverse_event THEN p_notes ELSE notes END,
    updated_at        = now()
  WHERE id = p_mar_id
    AND hospital_id = v_hospital_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'MAR slot not found or access denied');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$function$;

NOTIFY pgrst, 'reload schema';
