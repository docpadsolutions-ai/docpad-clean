-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411135142.

ALTER TABLE ipd_consent_types
  ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS template_body text,
  ADD COLUMN IF NOT EXISTS template_language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS version text DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE INDEX IF NOT EXISTS idx_consent_types_hospital 
  ON ipd_consent_types(hospital_id) WHERE hospital_id IS NOT NULL;

CREATE OR REPLACE VIEW consent_library AS
  SELECT 
    ct.*,
    CASE WHEN ct.hospital_id IS NULL THEN 'System Default' ELSE 'Custom' END as consent_source,
    CASE WHEN ct.file_path IS NOT NULL THEN true ELSE false END as has_pdf
  FROM ipd_consent_types ct;

NOTIFY pgrst, 'reload schema';
