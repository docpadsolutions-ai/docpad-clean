-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412062910.

-- 1. One OPD encounter → one admission max
CREATE UNIQUE INDEX IF NOT EXISTS uq_ipd_admissions_opd_encounter
  ON ipd_admissions (source_opd_encounter_id)
  WHERE source_opd_encounter_id IS NOT NULL;

-- 2. One active admission per patient at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_ipd_admissions_active_patient
  ON ipd_admissions (patient_id)
  WHERE status IN ('in-progress', 'admitted');

-- 3. Unique admission number per hospital
CREATE UNIQUE INDEX IF NOT EXISTS uq_ipd_admissions_number
  ON ipd_admissions (hospital_id, admission_number);
