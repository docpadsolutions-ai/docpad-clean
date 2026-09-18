-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414092519.

ALTER TABLE public.ipd_vitals
ADD COLUMN IF NOT EXISTS iv_fluid_ml     INTEGER,
ADD COLUMN IF NOT EXISTS oral_intake_ml  INTEGER,
ADD COLUMN IF NOT EXISTS other_intake_ml INTEGER,
ADD COLUMN IF NOT EXISTS other_output_ml INTEGER;

NOTIFY pgrst, 'reload schema';
