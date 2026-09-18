-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413145724.

-- Drop old strict unique (blocks any duplicate including failed/cancelled)
DROP INDEX IF EXISTS uq_ipd_admissions_opd_encounter;

-- New: only block if an ACTIVE admission exists for this OPD encounter
-- Allows re-admission if previous was cancelled or entered-in-error
CREATE UNIQUE INDEX uq_ipd_admissions_opd_encounter_active
ON public.ipd_admissions (source_opd_encounter_id)
WHERE source_opd_encounter_id IS NOT NULL
  AND status NOT IN ('cancelled', 'entered-in-error', 'finished');
