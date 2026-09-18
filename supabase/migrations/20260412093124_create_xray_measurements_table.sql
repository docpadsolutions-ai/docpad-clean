-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412093124.

-- X-ray measurement sessions
CREATE TABLE xray_measurements (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id             UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  encounter_id            UUID NOT NULL REFERENCES opd_encounters(id) ON DELETE CASCADE,
  patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id               UUID REFERENCES practitioners(id),

  specialty               TEXT NOT NULL CHECK (specialty IN ('orthopaedics', 'neurosurgery')),

  -- Image
  image_storage_path      TEXT,
  image_filename          TEXT,

  -- Calibration
  calibration_px_per_mm   NUMERIC,
  calibration_reference   TEXT,
  is_calibrated           BOOLEAN DEFAULT FALSE,

  -- Canvas state
  canvas_objects          JSONB DEFAULT '[]'::jsonb,
  measurements            JSONB DEFAULT '[]'::jsonb,

  -- Guided workflow
  preset_used             TEXT,
  preset_step             INTEGER,

  summary_text            TEXT,
  fhir_json               JSONB,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE xray_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_xray_measurements"
  ON xray_measurements FOR ALL
  USING (hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  ));

CREATE TRIGGER set_updated_at_xray_measurements
  BEFORE UPDATE ON xray_measurements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_xray_meas_encounter ON xray_measurements(encounter_id);
CREATE INDEX idx_xray_meas_patient   ON xray_measurements(patient_id);
CREATE INDEX idx_xray_meas_specialty ON xray_measurements(specialty);

-- Upsert RPC
CREATE OR REPLACE FUNCTION upsert_xray_measurement(
  p_hospital_id             UUID DEFAULT NULL,
  p_encounter_id            UUID DEFAULT NULL,
  p_patient_id              UUID DEFAULT NULL,
  p_doctor_id               UUID DEFAULT NULL,
  p_specialty               TEXT DEFAULT NULL,
  p_image_storage_path      TEXT DEFAULT NULL,
  p_image_filename          TEXT DEFAULT NULL,
  p_calibration_px_per_mm   NUMERIC DEFAULT NULL,
  p_calibration_reference   TEXT DEFAULT NULL,
  p_is_calibrated           BOOLEAN DEFAULT NULL,
  p_canvas_objects          JSONB DEFAULT NULL,
  p_measurements            JSONB DEFAULT NULL,
  p_preset_used             TEXT DEFAULT NULL,
  p_preset_step             INTEGER DEFAULT NULL,
  p_summary_text            TEXT DEFAULT NULL,
  p_fhir_json               JSONB DEFAULT NULL,
  p_id                      UUID DEFAULT NULL
)
RETURNS xray_measurements
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row xray_measurements;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE xray_measurements SET
      canvas_objects        = COALESCE(p_canvas_objects, canvas_objects),
      measurements          = COALESCE(p_measurements, measurements),
      calibration_px_per_mm = COALESCE(p_calibration_px_per_mm, calibration_px_per_mm),
      calibration_reference = COALESCE(p_calibration_reference, calibration_reference),
      is_calibrated         = COALESCE(p_is_calibrated, is_calibrated),
      preset_used           = COALESCE(p_preset_used, preset_used),
      preset_step           = COALESCE(p_preset_step, preset_step),
      summary_text          = COALESCE(p_summary_text, summary_text),
      fhir_json             = COALESCE(p_fhir_json, fhir_json),
      image_storage_path    = COALESCE(p_image_storage_path, image_storage_path),
      image_filename        = COALESCE(p_image_filename, image_filename)
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO xray_measurements (
      hospital_id, encounter_id, patient_id, doctor_id, specialty,
      image_storage_path, image_filename,
      calibration_px_per_mm, calibration_reference, is_calibrated,
      canvas_objects, measurements, preset_used, preset_step,
      summary_text, fhir_json
    ) VALUES (
      p_hospital_id, p_encounter_id, p_patient_id, p_doctor_id, p_specialty,
      p_image_storage_path, p_image_filename,
      p_calibration_px_per_mm, p_calibration_reference, COALESCE(p_is_calibrated, FALSE),
      COALESCE(p_canvas_objects, '[]'), COALESCE(p_measurements, '[]'),
      p_preset_used, p_preset_step, p_summary_text, p_fhir_json
    )
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

-- Fetch sessions for encounter
CREATE OR REPLACE FUNCTION get_xray_measurements_for_encounter(
  p_encounter_id UUID DEFAULT NULL
)
RETURNS SETOF xray_measurements
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM xray_measurements
  WHERE encounter_id = p_encounter_id
  ORDER BY created_at DESC;
$$;
