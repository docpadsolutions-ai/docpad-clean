-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416014629.

CREATE TABLE IF NOT EXISTS ipd_nursing_vitals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id        UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  recorded_by         UUID NOT NULL REFERENCES practitioners(id),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  blood_pressure      TEXT,
  pulse               INTEGER,
  temperature         NUMERIC(4,1),
  spo2                INTEGER,
  respiratory_rate    INTEGER,
  weight              NUMERIC(5,1),
  urine_output        NUMERIC(6,1),
  gcs_score           INTEGER,
  pain_score          INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  notes               TEXT,
  fhir_json           JSONB,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ipd_nursing_vitals_admission ON ipd_nursing_vitals(admission_id);
CREATE INDEX idx_ipd_nursing_vitals_recorded_at ON ipd_nursing_vitals(admission_id, recorded_at DESC);

ALTER TABLE ipd_nursing_vitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_vitals_select" ON ipd_nursing_vitals
  FOR SELECT USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

CREATE POLICY "hospital_staff_vitals_insert" ON ipd_nursing_vitals
  FOR INSERT WITH CHECK (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

CREATE POLICY "hospital_staff_vitals_update" ON ipd_nursing_vitals
  FOR UPDATE USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

CREATE TRIGGER set_ipd_nursing_vitals_updated_at
  BEFORE UPDATE ON ipd_nursing_vitals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
