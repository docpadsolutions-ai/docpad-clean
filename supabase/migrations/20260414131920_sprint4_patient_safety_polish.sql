-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414131920.

-- =====================================================================
-- SPRINT 4: PATIENT SAFETY + POLISH
-- Covers: pending result tracking, acknowledgements, patient photos,
--         result severity tiers, similar-name detection support
-- =====================================================================

-- 1. expected_at column on investigations (computed from ordered_at + TAT)
ALTER TABLE investigations 
  ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE investigations 
SET expected_at = ordered_at + (expected_tat_hours * INTERVAL '1 hour')
WHERE expected_tat_hours IS NOT NULL AND expected_at IS NULL;

-- Trigger: keep expected_at in sync
CREATE OR REPLACE FUNCTION set_investigation_expected_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expected_tat_hours IS NOT NULL THEN
    NEW.expected_at := NEW.ordered_at + (NEW.expected_tat_hours * INTERVAL '1 hour');
  ELSE
    NEW.expected_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_investigation_expected_at ON investigations;
CREATE TRIGGER trg_set_investigation_expected_at
  BEFORE INSERT OR UPDATE OF expected_tat_hours, ordered_at ON investigations
  FOR EACH ROW EXECUTE FUNCTION set_investigation_expected_at();

-- 2. result_severity tier for 4-level alert system
ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS result_severity TEXT DEFAULT 'normal'
  CHECK (result_severity IN ('critical', 'high', 'abnormal', 'normal'));

-- 3. Acknowledgement tracking on investigations
ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES practitioners(id);

-- 4. investigation_acknowledgements — NABH PSQ.7 compliant append-only audit log
CREATE TABLE IF NOT EXISTS investigation_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  acknowledged_by UUID NOT NULL REFERENCES practitioners(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_taken TEXT CHECK (action_taken IN (
    'reviewed', 'follow_up_ordered', 'patient_notified', 'no_action_needed', 'critical_escalated'
  )),
  notes TEXT,
  result_severity_at_ack TEXT, -- snapshot of severity at time of ack
  fhir_task_json JSONB         -- FHIR Task resource for interoperability
);

ALTER TABLE investigation_acknowledgements ENABLE ROW LEVEL SECURITY;

-- SELECT + INSERT only — no UPDATE/DELETE (append-only)
CREATE POLICY "ack_select_hospital_scoped" ON investigation_acknowledgements
  FOR SELECT USING (
    hospital_id IN (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "ack_insert_hospital_scoped" ON investigation_acknowledgements
  FOR INSERT WITH CHECK (
    hospital_id IN (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    )
  );

-- 5. patient_photos table — links to Supabase Storage
CREATE TABLE IF NOT EXISTS patient_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE UNIQUE,
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  storage_path TEXT NOT NULL, -- e.g. 'patient-photos/{patient_id}.jpg'
  thumbnail_path TEXT,        -- 32px thumbnail for list views
  uploaded_by UUID REFERENCES practitioners(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE patient_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "photos_hospital_scoped" ON patient_photos
  FOR ALL USING (
    hospital_id IN (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    )
  );

-- 6. similar_name_pairs view — pre-computes near-duplicate patient names
-- Used by frontend to show ⚠️ badge without client-side Levenshtein on every render
-- Uses trigram similarity (pg_trgm) for efficient fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE VIEW similar_name_pairs AS
SELECT 
  a.id AS patient_a_id,
  a.full_name AS name_a,
  b.id AS patient_b_id,
  b.full_name AS name_b,
  a.hospital_id,
  similarity(a.full_name, b.full_name) AS name_similarity
FROM patients a
JOIN patients b ON a.id < b.id AND a.hospital_id = b.hospital_id
WHERE similarity(a.full_name, b.full_name) > 0.6;

-- 7. Performance indexes
CREATE INDEX IF NOT EXISTS idx_investigations_pending_results
  ON investigations(hospital_id, result_status, expected_at)
  WHERE result_status IN ('pending', 'sample_collected', 'processing');

CREATE INDEX IF NOT EXISTS idx_investigations_unacked_results
  ON investigations(hospital_id, acknowledged_at, result_status)
  WHERE acknowledged_at IS NULL AND result_status = 'resulted';

CREATE INDEX IF NOT EXISTS idx_investigations_severity
  ON investigations(hospital_id, result_severity)
  WHERE result_severity IN ('critical', 'high');

CREATE INDEX IF NOT EXISTS idx_patients_fullname_trgm
  ON patients USING gin(full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_acks_investigation_id
  ON investigation_acknowledgements(investigation_id);

CREATE INDEX IF NOT EXISTS idx_acks_hospital_date
  ON investigation_acknowledgements(hospital_id, acknowledged_at DESC);
