-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417163950.

ALTER TABLE nursing_tasks DROP CONSTRAINT nursing_tasks_priority_check;
ALTER TABLE nursing_tasks ADD CONSTRAINT nursing_tasks_priority_check
  CHECK (lower(priority) = ANY (ARRAY['stat', 'urgent', 'routine']));
NOTIFY pgrst, 'reload schema';
