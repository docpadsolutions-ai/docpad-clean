-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412093740.

-- Doctor's saved measurement templates
-- Stores named sets of objects (lines/circles) as reusable templates
-- Coordinates stored as RELATIVE (0-1 normalized) so they adapt to any image size
CREATE TABLE xray_measurement_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  doctor_id       UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,           -- e.g. "My Knee Alignment Setup"
  description     TEXT,
  specialty       TEXT NOT NULL CHECK (specialty IN ('orthopaedics', 'neurosurgery')),
  body_region     TEXT,                    -- e.g. "knee", "spine", "hip", "cervical"

  -- Normalized canvas objects (x,y as 0.0–1.0 fractions of image dimensions)
  -- On load: multiply by actual image width/height to get pixel coords
  template_objects  JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Which measurements to auto-calculate after loading (angle/distance/cobb etc)
  auto_calculations JSONB DEFAULT '[]'::jsonb,
  -- e.g. [{"type":"angle","objectNames":["Femoral Axis","Tibial Axis"],"label":"Mechanical Axis"}]

  -- Usage tracking
  use_count       INTEGER DEFAULT 0,
  last_used_at    TIMESTAMPTZ,

  -- Scope: personal (only this doctor) or hospital-wide (shared with all doctors)
  is_shared       BOOLEAN DEFAULT FALSE,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE xray_measurement_templates ENABLE ROW LEVEL SECURITY;

-- Doctor sees own templates + shared templates from same hospital
CREATE POLICY "xray_templates_select"
  ON xray_measurement_templates FOR SELECT
  USING (
    hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid())
    AND (
      is_shared = TRUE
      OR doctor_id IN (SELECT id FROM practitioners WHERE user_id = auth.uid())
    )
  );

-- Only own templates can be inserted/updated/deleted
CREATE POLICY "xray_templates_write"
  ON xray_measurement_templates FOR ALL
  USING (
    doctor_id IN (SELECT id FROM practitioners WHERE user_id = auth.uid())
  );

CREATE TRIGGER set_updated_at_xray_templates
  BEFORE UPDATE ON xray_measurement_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_xray_templates_doctor   ON xray_measurement_templates(doctor_id);
CREATE INDEX idx_xray_templates_hospital ON xray_measurement_templates(hospital_id, specialty);

-- RPC: save a new template
CREATE OR REPLACE FUNCTION save_xray_template(
  p_hospital_id       UUID DEFAULT NULL,
  p_doctor_id         UUID DEFAULT NULL,
  p_name              TEXT DEFAULT NULL,
  p_description       TEXT DEFAULT NULL,
  p_specialty         TEXT DEFAULT NULL,
  p_body_region       TEXT DEFAULT NULL,
  p_template_objects  JSONB DEFAULT NULL,
  p_auto_calculations JSONB DEFAULT NULL,
  p_is_shared         BOOLEAN DEFAULT NULL,
  p_id                UUID DEFAULT NULL      -- pass to update existing
)
RETURNS xray_measurement_templates
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row xray_measurement_templates;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE xray_measurement_templates SET
      name              = COALESCE(p_name, name),
      description       = COALESCE(p_description, description),
      body_region       = COALESCE(p_body_region, body_region),
      template_objects  = COALESCE(p_template_objects, template_objects),
      auto_calculations = COALESCE(p_auto_calculations, auto_calculations),
      is_shared         = COALESCE(p_is_shared, is_shared)
    WHERE id = p_id
      AND doctor_id = p_doctor_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO xray_measurement_templates (
      hospital_id, doctor_id, name, description, specialty,
      body_region, template_objects, auto_calculations, is_shared
    ) VALUES (
      p_hospital_id, p_doctor_id, p_name, p_description, p_specialty,
      p_body_region,
      COALESCE(p_template_objects, '[]'),
      COALESCE(p_auto_calculations, '[]'),
      COALESCE(p_is_shared, FALSE)
    )
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

-- RPC: get templates for a doctor + specialty
CREATE OR REPLACE FUNCTION get_xray_templates(
  p_specialty   TEXT DEFAULT NULL,
  p_doctor_id   UUID DEFAULT NULL,
  p_hospital_id UUID DEFAULT NULL
)
RETURNS SETOF xray_measurement_templates
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM xray_measurement_templates
  WHERE hospital_id = p_hospital_id
    AND specialty   = p_specialty
    AND (is_shared = TRUE OR doctor_id = p_doctor_id)
  ORDER BY use_count DESC, created_at DESC;
$$;

-- RPC: increment use count when template is loaded
CREATE OR REPLACE FUNCTION use_xray_template(
  p_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE xray_measurement_templates
  SET use_count    = use_count + 1,
      last_used_at = NOW()
  WHERE id = p_id;
$$;

-- RPC: delete a template (own templates only)
CREATE OR REPLACE FUNCTION delete_xray_template(
  p_id        UUID DEFAULT NULL,
  p_doctor_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM xray_measurement_templates
  WHERE id = p_id AND doctor_id = p_doctor_id;
$$;
