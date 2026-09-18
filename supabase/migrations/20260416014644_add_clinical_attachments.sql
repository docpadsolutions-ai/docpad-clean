-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416014644.

-- Clinical image/file attachments for OPD encounters and IPD admissions
CREATE TABLE IF NOT EXISTS clinical_attachments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Link to either OPD or IPD (nullable, at least one must be set — enforced by CHECK)
  opd_encounter_id      UUID REFERENCES opd_encounters(id) ON DELETE CASCADE,
  ipd_admission_id      UUID REFERENCES ipd_admissions(id) ON DELETE CASCADE,

  uploaded_by           UUID NOT NULL REFERENCES practitioners(id),
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Storage
  storage_path          TEXT NOT NULL,   -- Supabase storage bucket path
  file_name             TEXT NOT NULL,
  file_size_bytes       INTEGER,
  mime_type             TEXT NOT NULL,   -- image/jpeg, image/png, image/heic, application/pdf

  -- Clinical metadata
  attachment_type       TEXT NOT NULL DEFAULT 'clinical_image',
  -- clinical_image | wound_photo | xray | document | ecg | other
  body_region           TEXT,           -- e.g. "right knee", "lumbar spine"
  clinical_context      TEXT,           -- free text note about the image
  is_sensitive          BOOLEAN DEFAULT FALSE,

  -- FHIR: maps to DocumentReference or Media resource
  fhir_json             JSONB,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT must_have_encounter CHECK (
    opd_encounter_id IS NOT NULL OR ipd_admission_id IS NOT NULL
  )
);

CREATE INDEX idx_clinical_attachments_opd ON clinical_attachments(opd_encounter_id) WHERE opd_encounter_id IS NOT NULL;
CREATE INDEX idx_clinical_attachments_ipd ON clinical_attachments(ipd_admission_id) WHERE ipd_admission_id IS NOT NULL;
CREATE INDEX idx_clinical_attachments_patient ON clinical_attachments(patient_id, uploaded_at DESC);

ALTER TABLE clinical_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_attachments_select" ON clinical_attachments
  FOR SELECT USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

CREATE POLICY "hospital_staff_attachments_insert" ON clinical_attachments
  FOR INSERT WITH CHECK (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

CREATE POLICY "hospital_staff_attachments_update" ON clinical_attachments
  FOR UPDATE USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

CREATE TRIGGER set_clinical_attachments_updated_at
  BEFORE UPDATE ON clinical_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
