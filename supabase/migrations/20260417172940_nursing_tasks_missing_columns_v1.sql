-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417172940.

-- Add missing columns (all optional/nullable, safe to add)
ALTER TABLE nursing_tasks
  ADD COLUMN IF NOT EXISTS scheduled_shift text GENERATED ALWAYS AS (shift) STORED,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_order_text text,
  ADD COLUMN IF NOT EXISTS completed_notes text,
  ADD COLUMN IF NOT EXISTS skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS skipped_by uuid;

NOTIFY pgrst, 'reload schema';
