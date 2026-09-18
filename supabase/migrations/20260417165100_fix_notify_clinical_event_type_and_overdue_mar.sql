-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417165100.

-- Fix notify_clinical_event to include type column
CREATE OR REPLACE FUNCTION public.notify_clinical_event(
  p_hospital_id uuid,
  p_recipient_id uuid,
  p_recipient_role text,
  p_context text,
  p_category text,
  p_priority text,
  p_title text,
  p_body text,
  p_reference_type text,
  p_reference_id uuid,
  p_action_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO notifications (
    hospital_id, recipient_id, recipient_role,
    type, context, category, priority,
    title, body,
    reference_type, reference_id,
    action_url,
    expires_at
  ) VALUES (
    p_hospital_id, p_recipient_id, p_recipient_role,
    p_category,   -- type = category (e.g. 'mar_overdue', 'vitals_alert')
    p_context, p_category, p_priority,
    p_title, p_body,
    p_reference_type, p_reference_id,
    p_action_url,
    now() + INTERVAL '7 days'
  );
END;
$function$;

-- Re-run overdue check to fire missed notifications now
SELECT notify_overdue_mar_slots();

NOTIFY pgrst, 'reload schema';
