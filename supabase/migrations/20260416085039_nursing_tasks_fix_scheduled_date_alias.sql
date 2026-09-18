-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416085039.

-- The frontend is sending 'scheduled_date' but the column is 'due_date'
-- Add alias column so both work
ALTER TABLE nursing_tasks ADD COLUMN IF NOT EXISTS scheduled_date DATE
  GENERATED ALWAYS AS (due_date) STORED;

NOTIFY pgrst, 'reload schema';
