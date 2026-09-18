-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416100624.

-- ============================================================
-- 1. RLS for ipd_wound_assessments
-- ============================================================
ALTER TABLE ipd_wound_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wound_hospital_access" ON ipd_wound_assessments;
CREATE POLICY "wound_hospital_access" ON ipd_wound_assessments
  FOR ALL USING (
    hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1)
  );

-- ============================================================
-- 2. Multi-photo support: wound_photos table
--    One assessment can have multiple angles/timepoints
-- ============================================================
CREATE TABLE IF NOT EXISTS ipd_wound_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES hospitals(id),
  assessment_id   uuid NOT NULL REFERENCES ipd_wound_assessments(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES patients(id),
  storage_path    text NOT NULL,          -- path in 'wound-photos' bucket
  photo_label     text,                   -- 'anterior', 'lateral', 'close-up', etc.
  taken_at        timestamptz NOT NULL DEFAULT NOW(),
  taken_by        uuid REFERENCES practitioners(id),
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wound_photos_assessment ON ipd_wound_photos(assessment_id);

ALTER TABLE ipd_wound_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wound_photos_hospital_access" ON ipd_wound_photos
  FOR ALL USING (
    hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1)
  );

-- ============================================================
-- 3. Drain shift log — per-shift drain character record
--    (separate from wound assessment for high-frequency recording)
-- ============================================================
CREATE TABLE IF NOT EXISTS ipd_drain_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES hospitals(id),
  admission_id    uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES patients(id),
  wound_assessment_id uuid REFERENCES ipd_wound_assessments(id),

  recorded_at     timestamptz NOT NULL DEFAULT NOW(),
  recorded_by     uuid REFERENCES practitioners(id),
  shift           text CHECK (shift IN ('morning','afternoon','night')),

  drain_name      text NOT NULL DEFAULT 'Surgical Drain',   -- e.g. 'Redivac #1', 'Hemovac'
  drain_type      text,  -- 'closed_suction' | 'open' | 'penrose' | 'jackson_pratt'
  output_ml       integer,
  colour          text,  -- 'sanguinous' | 'serosanguinous' | 'serous' | 'purulent' | 'bilious'
  consistency     text,  -- 'thin' | 'thick' | 'clotted'
  odour           text,  -- 'none' | 'mild' | 'offensive'
  drain_site_ok   boolean DEFAULT true,
  drain_removed   boolean DEFAULT false,
  removed_by      uuid REFERENCES practitioners(id),
  removed_at      timestamptz,
  notes           text,

  fhir_json       jsonb,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drain_records_admission ON ipd_drain_records(admission_id);

ALTER TABLE ipd_drain_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drain_records_hospital_access" ON ipd_drain_records
  FOR ALL USING (
    hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1)
  );

-- FHIR Observation trigger for drain records
CREATE OR REPLACE FUNCTION build_drain_fhir_json()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.fhir_json := jsonb_build_object(
    'resourceType', 'Observation',
    'id', NEW.id::text,
    'status', 'final',
    'category', jsonb_build_array(jsonb_build_object(
      'coding', jsonb_build_array(jsonb_build_object(
        'system', 'http://terminology.hl7.org/CodeSystem/observation-category',
        'code', 'procedure', 'display', 'Procedure'
      ))
    )),
    'code', jsonb_build_object(
      'coding', jsonb_build_array(jsonb_build_object(
        'system', 'http://snomed.info/sct',
        'code', '305351004',
        'display', 'Drain output measurement'
      )),
      'text', NEW.drain_name
    ),
    'subject', jsonb_build_object('reference', 'Patient/' || NEW.patient_id::text),
    'encounter', jsonb_build_object('reference', 'Encounter/' || NEW.admission_id::text),
    'effectiveDateTime', NEW.recorded_at::text,
    'valueQuantity', jsonb_build_object(
      'value', NEW.output_ml,
      'unit', 'mL',
      'system', 'http://unitsofmeasure.org',
      'code', 'mL'
    ),
    'note', jsonb_build_array(jsonb_build_object(
      'text', CONCAT('Colour: ', NEW.colour, ' | Consistency: ', NEW.consistency)
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_drain_fhir
  BEFORE INSERT OR UPDATE ON ipd_drain_records
  FOR EACH ROW EXECUTE FUNCTION build_drain_fhir_json();

-- ============================================================
-- 4. FHIR Observation trigger for wound assessments
-- ============================================================
CREATE OR REPLACE FUNCTION build_wound_fhir_json()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.fhir_json := jsonb_build_object(
    'resourceType', 'Observation',
    'id', NEW.id::text,
    'status', 'final',
    'category', jsonb_build_array(jsonb_build_object(
      'coding', jsonb_build_array(jsonb_build_object(
        'system', 'http://terminology.hl7.org/CodeSystem/observation-category',
        'code', 'exam'
      ))
    )),
    'code', jsonb_build_object(
      'coding', jsonb_build_array(jsonb_build_object(
        'system', 'http://snomed.info/sct',
        'code', '225317008',
        'display', 'Wound assessment'
      ))
    ),
    'subject', jsonb_build_object('reference', 'Patient/' || NEW.patient_id::text),
    'encounter', jsonb_build_object('reference', 'Encounter/' || NEW.admission_id::text),
    'effectiveDateTime', NEW.assessed_at::text,
    'component', jsonb_build_array(
      jsonb_build_object('code', jsonb_build_object('text','Wound Type'), 'valueString', NEW.wound_type),
      jsonb_build_object('code', jsonb_build_object('text','Discharge'), 'valueString', NEW.discharge_type),
      jsonb_build_object('code', jsonb_build_object('text','Suture Status'), 'valueString', NEW.suture_status),
      jsonb_build_object('code', jsonb_build_object('text','Erythema'), 'valueString', NEW.erythema),
      jsonb_build_object('code', jsonb_build_object('text','Swelling'), 'valueString', NEW.swelling),
      jsonb_build_object('code', jsonb_build_object('text','Dehiscence'), 'valueBoolean', NEW.wound_dehiscence)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wound_fhir ON ipd_wound_assessments;
CREATE TRIGGER trg_wound_fhir
  BEFORE INSERT OR UPDATE ON ipd_wound_assessments
  FOR EACH ROW EXECUTE FUNCTION build_wound_fhir_json();

-- ============================================================
-- 5. Storage RLS for wound-photos bucket (created via dashboard)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'wound-photos'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('wound-photos', 'wound-photos', false, 10485760,
      ARRAY['image/jpeg','image/png','image/heic','image/webp']);
  END IF;
END $$;

DROP POLICY IF EXISTS "wound_photos_upload" ON storage.objects;
CREATE POLICY "wound_photos_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'wound-photos'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "wound_photos_read" ON storage.objects;
CREATE POLICY "wound_photos_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'wound-photos'
    AND auth.role() = 'authenticated'
  );

NOTIFY pgrst, 'reload schema';
