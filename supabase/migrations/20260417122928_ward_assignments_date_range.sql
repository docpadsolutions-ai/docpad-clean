-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417122928.

-- Add start_date and end_date columns
ALTER TABLE ward_staff_assignments
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- Migrate existing assigned_date data into start_date
UPDATE ward_staff_assignments
SET start_date = assigned_date,
    end_date = assigned_date
WHERE start_date IS NULL;

-- Backfill NOT NULL after data migration
ALTER TABLE ward_staff_assignments
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN end_date SET NOT NULL;

-- Add constraint: end_date >= start_date
ALTER TABLE ward_staff_assignments
  ADD CONSTRAINT chk_date_range CHECK (end_date >= start_date);

-- Drop old single-date column
ALTER TABLE ward_staff_assignments DROP COLUMN IF EXISTS assigned_date;

-- Update index if any existed on assigned_date (recreate on start_date)
CREATE INDEX IF NOT EXISTS idx_ward_staff_start_date ON ward_staff_assignments(start_date);
CREATE INDEX IF NOT EXISTS idx_ward_staff_end_date ON ward_staff_assignments(end_date);
