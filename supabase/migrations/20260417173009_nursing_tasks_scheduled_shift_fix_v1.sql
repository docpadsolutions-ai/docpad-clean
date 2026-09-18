-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417173009.

-- Drop the generated column, replace with plain column synced via trigger
ALTER TABLE nursing_tasks DROP COLUMN IF EXISTS scheduled_shift;
ALTER TABLE nursing_tasks ADD COLUMN IF NOT EXISTS scheduled_shift text;

-- Backfill from shift
UPDATE nursing_tasks SET scheduled_shift = shift WHERE scheduled_shift IS NULL;

-- Keep in sync going forward
CREATE OR REPLACE FUNCTION fn_sync_scheduled_shift()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.scheduled_shift := NEW.shift;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_scheduled_shift ON nursing_tasks;
CREATE TRIGGER trg_sync_scheduled_shift
  BEFORE INSERT OR UPDATE ON nursing_tasks
  FOR EACH ROW EXECUTE FUNCTION fn_sync_scheduled_shift();

NOTIFY pgrst, 'reload schema';
