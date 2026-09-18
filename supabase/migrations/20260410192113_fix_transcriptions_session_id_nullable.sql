-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260410192113.

-- Make session_id nullable so transcriptions can be saved without a voice_session
ALTER TABLE transcriptions ALTER COLUMN session_id DROP NOT NULL;

-- Add encounter_id directly to transcriptions for easier linking
ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES opd_encounters(id);
ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS doctor_id UUID;
ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS context_type TEXT;

-- Also fix clinical_extractions — add encounter_id for direct linking
ALTER TABLE clinical_extractions ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES opd_encounters(id);
ALTER TABLE clinical_extractions ADD COLUMN IF NOT EXISTS doctor_id UUID;

NOTIFY pgrst, 'reload schema';
