-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416014736.

CREATE TABLE IF NOT EXISTS ipd_consents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id          UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consent_type          TEXT NOT NULL,
  is_custom             BOOLEAN NOT NULL DEFAULT FALSE,
  custom_title          TEXT,
  custom_description    TEXT,
  consent_template_id   UUID,
  status                TEXT NOT NULL DEFAULT 'pending',
  requested_by          UUID NOT NULL REFERENCES practitioners(id),
  obtained_by           UUID REFERENCES practitioners(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  obtained_at           TIMESTAMPTZ,
  expiry_at             TIMESTAMPTZ,
  witness_name          TEXT,
  patient_signature_url TEXT,
  witness_signature_url TEXT,
  is_emergency_override BOOLEAN DEFAULT FALSE,
  override_reason       TEXT,
  signed_document_path  TEXT,
  notes                 TEXT,
  fhir_json             JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT custom_consent_must_have_title CHECK (
    is_custom = FALSE OR (is_custom = TRUE AND custom_title IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ipd_consents_admission ON ipd_consents(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_consents_status ON ipd_consents(admission_id, status);

ALTER TABLE ipd_consents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ipd_consents' AND policyname = 'ipd_consents_select') THEN
    CREATE POLICY "ipd_consents_select" ON ipd_consents
      FOR SELECT USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ipd_consents' AND policyname = 'ipd_consents_insert') THEN
    CREATE POLICY "ipd_consents_insert" ON ipd_consents
      FOR INSERT WITH CHECK (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ipd_consents' AND policyname = 'ipd_consents_update') THEN
    CREATE POLICY "ipd_consents_update" ON ipd_consents
      FOR UPDATE USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE TRIGGER set_ipd_consents_updated_at
  BEFORE UPDATE ON ipd_consents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
