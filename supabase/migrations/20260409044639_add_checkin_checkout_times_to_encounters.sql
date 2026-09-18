-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409044639.

-- Add checkin_time and checkout_time columns to opd_encounters
ALTER TABLE opd_encounters 
  ADD COLUMN checkin_time TIMESTAMP WITH TIME ZONE,
  ADD COLUMN checkout_time TIMESTAMP WITH TIME ZONE;

-- Backfill checkin_time from created_at for existing records
UPDATE opd_encounters 
SET checkin_time = created_at 
WHERE checkin_time IS NULL;

-- Set checkin_time default for future inserts
ALTER TABLE opd_encounters 
  ALTER COLUMN checkin_time SET DEFAULT NOW();

-- Add index for analytics queries
CREATE INDEX IF NOT EXISTS idx_opd_encounters_checkin_time 
  ON opd_encounters(hospital_id, checkin_time);

COMMENT ON COLUMN opd_encounters.checkin_time IS 'Timestamp when patient checked in for consultation';
COMMENT ON COLUMN opd_encounters.checkout_time IS 'Timestamp when consultation completed and patient checked out';
