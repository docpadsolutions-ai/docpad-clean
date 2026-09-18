-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411085243.

ALTER TABLE ipd_pre_admission_assessments ADD COLUMN IF NOT EXISTS chief_complaint_details TEXT;
