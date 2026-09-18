-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411142942.

ALTER TABLE ipd_progress_notes
  ADD COLUMN IF NOT EXISTS symptoms_json jsonb,
  ADD COLUMN IF NOT EXISTS snomed_assessment jsonb,
  ADD COLUMN IF NOT EXISTS snomed_findings jsonb;

NOTIFY pgrst, 'reload schema';
