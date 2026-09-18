-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413164125.

-- Add missing columns
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS context TEXT CHECK (context IN ('OPD', 'IPD', 'SYSTEM')) DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS recipient_role TEXT,
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id UUID,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days');

-- Make recipient_id nullable for role-based broadcasts
ALTER TABLE notifications ALTER COLUMN recipient_id DROP NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_context
  ON notifications(recipient_id, context, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_hospital_context
  ON notifications(hospital_id, context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_reference
  ON notifications(reference_type, reference_id);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_notifications" ON notifications;
CREATE POLICY "users_see_own_notifications" ON notifications
  FOR SELECT USING (
    recipient_id = auth.uid()
    OR (
      recipient_id IS NULL
      AND hospital_id IN (
        SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "users_mark_read" ON notifications;
CREATE POLICY "users_mark_read" ON notifications
  FOR UPDATE USING (
    recipient_id = auth.uid()
    OR (
      recipient_id IS NULL
      AND hospital_id IN (
        SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_insert_notifications" ON notifications;
CREATE POLICY "service_insert_notifications" ON notifications
  FOR INSERT WITH CHECK (
    hospital_id IN (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
