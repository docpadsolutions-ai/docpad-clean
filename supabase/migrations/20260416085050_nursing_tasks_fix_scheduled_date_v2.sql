-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416085050.

-- Drop the generated column approach, use a trigger-based sync instead
ALTER TABLE nursing_tasks DROP COLUMN IF EXISTS scheduled_date;

-- Add scheduled_date as a plain writable column, synced to due_date
ALTER TABLE nursing_tasks ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- Backfill
UPDATE nursing_tasks SET scheduled_date = due_date WHERE scheduled_date IS NULL;

-- Trigger: keep scheduled_date and due_date in sync (accept either from frontend)
CREATE OR REPLACE FUNCTION sync_nursing_task_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scheduled_date IS NOT NULL AND NEW.due_date IS NULL THEN
    NEW.due_date := NEW.scheduled_date;
  ELSIF NEW.due_date IS NOT NULL AND NEW.scheduled_date IS NULL THEN
    NEW.scheduled_date := NEW.due_date;
  ELSIF NEW.due_date IS NOT NULL THEN
    NEW.scheduled_date := NEW.due_date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nursing_tasks_sync_dates
  BEFORE INSERT OR UPDATE ON nursing_tasks
  FOR EACH ROW EXECUTE FUNCTION sync_nursing_task_dates();

NOTIFY pgrst, 'reload schema';
