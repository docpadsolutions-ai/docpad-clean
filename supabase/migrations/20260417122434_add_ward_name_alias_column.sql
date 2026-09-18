-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417122434.

ALTER TABLE ipd_wards ADD COLUMN IF NOT EXISTS ward_name TEXT GENERATED ALWAYS AS (name) STORED;
