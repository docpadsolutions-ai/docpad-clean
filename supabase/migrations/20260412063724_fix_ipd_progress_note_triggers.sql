-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412063724.

-- TRIGGER 1: Auto-set hospital_day_number when a progress note is inserted/updated
CREATE OR REPLACE FUNCTION set_progress_note_hospital_day()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate hospital day from admission admitted_at
  SELECT GREATEST(
    DATE_PART('day', NEW.note_date::timestamp - ia.admitted_at::date)::int + 1,
    1
  )
  INTO NEW.hospital_day_number
  FROM ipd_admissions ia
  WHERE ia.id = NEW.admission_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_progress_note_hospital_day ON ipd_progress_notes;
CREATE TRIGGER trg_set_progress_note_hospital_day
  BEFORE INSERT OR UPDATE ON ipd_progress_notes
  FOR EACH ROW
  EXECUTE FUNCTION set_progress_note_hospital_day();

-- TRIGGER 2: When a progress note is signed, propagate diagnosis up to ipd_admissions
CREATE OR REPLACE FUNCTION sync_diagnosis_to_admission()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync when note is being signed (status changes to 'signed')
  IF NEW.status = 'signed' AND (OLD.status IS DISTINCT FROM 'signed') THEN
    UPDATE ipd_admissions
    SET 
      primary_diagnosis_display = COALESCE(NEW.assessment_text, primary_diagnosis_display),
      updated_at = NOW()
    WHERE id = NEW.admission_id
      AND (primary_diagnosis_display IS NULL OR primary_diagnosis_display = '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_diagnosis_to_admission ON ipd_progress_notes;
CREATE TRIGGER trg_sync_diagnosis_to_admission
  AFTER UPDATE ON ipd_progress_notes
  FOR EACH ROW
  EXECUTE FUNCTION sync_diagnosis_to_admission();

-- TRIGGER 3: One progress note per admission per day (prevent duplicates)
CREATE OR REPLACE FUNCTION check_one_note_per_day()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ipd_progress_notes
    WHERE admission_id = NEW.admission_id
      AND note_date = NEW.note_date
      AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'A progress note already exists for this admission on %. Only one note per day is allowed.', NEW.note_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_note_per_day ON ipd_progress_notes;
CREATE TRIGGER trg_one_note_per_day
  BEFORE INSERT ON ipd_progress_notes
  FOR EACH ROW
  EXECUTE FUNCTION check_one_note_per_day();

-- Fix existing notes that have hospital_day_number = 0
UPDATE ipd_progress_notes pn
SET hospital_day_number = GREATEST(
  DATE_PART('day', pn.note_date::timestamp - ia.admitted_at::date)::int + 1,
  1
)
FROM ipd_admissions ia
WHERE pn.admission_id = ia.id
  AND pn.hospital_day_number = 0;
