-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411094150.

ALTER TABLE ipd_treatments ADD COLUMN IF NOT EXISTS treatment_date DATE GENERATED ALWAYS AS (ordered_date) STORED;
