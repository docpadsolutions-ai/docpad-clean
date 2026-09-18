-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409061800.

-- Drop existing constraint
ALTER TABLE appointments 
DROP CONSTRAINT IF EXISTS appointments_status_check;

-- Add new constraint with 'registered' status
ALTER TABLE appointments
ADD CONSTRAINT appointments_status_check 
CHECK (status IN ('scheduled', 'registered', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show'));
