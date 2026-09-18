-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417173035.

-- Update trigger to sync BOTH ways — whichever is provided populates the other
CREATE OR REPLACE FUNCTION fn_sync_scheduled_shift()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shift IS NULL AND NEW.scheduled_shift IS NOT NULL THEN
    NEW.shift := NEW.scheduled_shift;
  ELSIF NEW.scheduled_shift IS NULL AND NEW.shift IS NOT NULL THEN
    NEW.scheduled_shift := NEW.shift;
  ELSIF NEW.shift IS NOT NULL THEN
    NEW.scheduled_shift := NEW.shift;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
