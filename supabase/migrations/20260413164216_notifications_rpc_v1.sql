-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413164216.

-- Get notifications for current user, filtered by context
CREATE OR REPLACE FUNCTION get_notifications(
  p_context TEXT DEFAULT NULL,  -- 'OPD' | 'IPD' | NULL (all)
  p_limit INT DEFAULT 30,
  p_unread_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  context TEXT,
  category TEXT,
  priority TEXT,
  title TEXT,
  body TEXT,
  is_read BOOLEAN,
  reference_type TEXT,
  reference_id UUID,
  action_url TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
  v_user_id UUID := auth.uid();
BEGIN
  SELECT hospital_id INTO v_hospital_id
  FROM practitioners WHERE user_id = v_user_id LIMIT 1;

  RETURN QUERY
  SELECT
    n.id, n.context, n.category, n.priority,
    n.title, n.body, n.is_read,
    n.reference_type, n.reference_id, n.action_url,
    n.created_at
  FROM notifications n
  WHERE
    n.hospital_id = v_hospital_id
    AND (n.recipient_id = v_user_id OR n.recipient_id IS NULL)
    AND (p_context IS NULL OR n.context = p_context)
    AND (NOT p_unread_only OR n.is_read = FALSE)
    AND (n.expires_at IS NULL OR n.expires_at > now())
  ORDER BY
    CASE n.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
    n.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Get unread counts per context (for badge display)
CREATE OR REPLACE FUNCTION get_notification_counts()
RETURNS TABLE (context TEXT, unread_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
  v_user_id UUID := auth.uid();
BEGIN
  SELECT hospital_id INTO v_hospital_id
  FROM practitioners WHERE user_id = v_user_id LIMIT 1;

  RETURN QUERY
  SELECT n.context, COUNT(*) AS unread_count
  FROM notifications n
  WHERE
    n.hospital_id = v_hospital_id
    AND (n.recipient_id = v_user_id OR n.recipient_id IS NULL)
    AND n.is_read = FALSE
    AND (n.expires_at IS NULL OR n.expires_at > now())
  GROUP BY n.context;
END;
$$;

-- Mark notifications as read
CREATE OR REPLACE FUNCTION mark_notifications_read(
  p_ids UUID[] DEFAULT NULL,   -- NULL = mark all in context as read
  p_context TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hospital_id UUID;
  v_user_id UUID := auth.uid();
  v_count INT;
BEGIN
  SELECT hospital_id INTO v_hospital_id
  FROM practitioners WHERE user_id = v_user_id LIMIT 1;

  UPDATE notifications
  SET is_read = TRUE, read_at = now()
  WHERE
    hospital_id = v_hospital_id
    AND (recipient_id = v_user_id OR recipient_id IS NULL)
    AND is_read = FALSE
    AND (p_ids IS NULL OR id = ANY(p_ids))
    AND (p_context IS NULL OR context = p_context);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
