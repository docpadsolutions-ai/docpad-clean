-- Notifications: context (OPD/IPD), read tracking, RPCs, realtime.

-- Ensure columns exist on legacy notifications table (created outside this repo in some envs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'context'
    ) THEN
      ALTER TABLE public.notifications ADD COLUMN context text NOT NULL DEFAULT 'IPD';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read_at'
    ) THEN
      ALTER TABLE public.notifications ADD COLUMN read_at timestamptz;
    END IF;
  END IF;
END $$;

-- Create table when missing (fresh environments).
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.practitioners (id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.practitioners (id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'generic',
  priority text NOT NULL DEFAULT 'normal',
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}'::jsonb,
  action_url text,
  context text NOT NULL DEFAULT 'IPD',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Priority / context checks (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_priority_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'critical'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_context_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_context_check
      CHECK (context IN ('OPD', 'IPD'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_context_unread
  ON public.notifications (recipient_id, context)
  WHERE read_at IS NULL;

-- Resolve practitioner row for the signed-in user (JWT).
CREATE OR REPLACE FUNCTION public.current_practitioner_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT id INTO pid FROM public.practitioners WHERE id = auth.uid() LIMIT 1;
  IF pid IS NOT NULL THEN RETURN pid; END IF;
  SELECT id INTO pid FROM public.practitioners WHERE user_id = auth.uid() LIMIT 1;
  RETURN pid;
END;
$$;

REVOKE ALL ON FUNCTION public.current_practitioner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_practitioner_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_practitioner_id() TO service_role;

-- List notifications for the current practitioner, scoped by OPD/IPD.
CREATE OR REPLACE FUNCTION public.get_notifications(p_context text)
RETURNS SETOF public.notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.*
  FROM public.notifications n
  WHERE n.recipient_id = public.current_practitioner_id()
    AND n.context = p_context
  ORDER BY n.created_at DESC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.get_notifications(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notifications(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notifications(text) TO service_role;

-- Mark one notification read, or all unread in a context, or all unread globally.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_notification_id uuid DEFAULT NULL,
  p_context text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid := public.current_practitioner_id();
BEGIN
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as practitioner';
  END IF;

  IF p_notification_id IS NOT NULL THEN
    UPDATE public.notifications
    SET read_at = now()
    WHERE id = p_notification_id
      AND recipient_id = pid
      AND read_at IS NULL;
    RETURN;
  END IF;

  IF p_context IS NOT NULL THEN
    UPDATE public.notifications
    SET read_at = now()
    WHERE recipient_id = pid
      AND context = p_context
      AND read_at IS NULL;
    RETURN;
  END IF;

  UPDATE public.notifications
  SET read_at = now()
  WHERE recipient_id = pid
    AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid, text) TO service_role;

-- Unread counts by context.
CREATE OR REPLACE FUNCTION public.get_notification_counts()
RETURNS TABLE (opd bigint, ipd bigint, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE n.context = 'OPD' AND n.read_at IS NULL)::bigint AS opd,
    count(*) FILTER (WHERE n.context = 'IPD' AND n.read_at IS NULL)::bigint AS ipd,
    count(*) FILTER (WHERE n.read_at IS NULL)::bigint AS total
  FROM public.notifications n
  WHERE n.recipient_id = public.current_practitioner_id();
$$;

REVOKE ALL ON FUNCTION public.get_notification_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_counts() TO service_role;

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
  ON public.notifications
  FOR SELECT
  USING (recipient_id = public.current_practitioner_id());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
  ON public.notifications
  FOR UPDATE
  USING (recipient_id = public.current_practitioner_id());

-- Inserts originate from clinical flows (lab, scheduling, etc.): allow authenticated hospital staff.
DROP POLICY IF EXISTS notifications_insert_staff ON public.notifications;
CREATE POLICY notifications_insert_staff
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    hospital_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.practitioners p
      WHERE (p.id = auth.uid() OR p.user_id = auth.uid())
        AND p.hospital_id = notifications.hospital_id
    )
  );

-- Realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
