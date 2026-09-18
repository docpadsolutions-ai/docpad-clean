-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411085708.

ALTER TABLE ipd_pre_admission_assessments ADD COLUMN IF NOT EXISTS practitioner_id UUID;
