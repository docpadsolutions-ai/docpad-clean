-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409054402.

-- Drop the redundant FK from opd_encounters to appointments
-- Keeping appointments.encounter_id -> opd_encounters.id as single source of truth
ALTER TABLE opd_encounters 
DROP CONSTRAINT IF EXISTS opd_encounters_appointment_id_fkey;

-- Optional: Drop the column if it's no longer needed
-- Uncomment if you want to remove the column entirely
-- ALTER TABLE opd_encounters DROP COLUMN IF EXISTS appointment_id;
