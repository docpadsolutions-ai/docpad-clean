-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409053929.

ALTER TABLE feature_flags 
  ADD COLUMN flag_name TEXT;

-- Backfill flag_name from feature_key
UPDATE feature_flags 
SET flag_name = feature_key 
WHERE flag_name IS NULL;
