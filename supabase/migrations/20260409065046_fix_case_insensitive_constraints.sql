-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409065046.

-- Fix role constraint to accept case-insensitive values
ALTER TABLE invitations 
DROP CONSTRAINT IF EXISTS invitations_role_check;

ALTER TABLE invitations 
ADD CONSTRAINT invitations_role_check 
CHECK (
  LOWER(role) = ANY (ARRAY['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'])
);

-- Fix designation constraint to accept case-insensitive values
ALTER TABLE invitations 
DROP CONSTRAINT IF EXISTS invitations_designation_check;

ALTER TABLE invitations 
ADD CONSTRAINT invitations_designation_check 
CHECK (
  LOWER(designation) = ANY (ARRAY[
    'senior consultant', 
    'consultant', 
    'associate professor', 
    'assistant professor', 
    'senior resident', 
    'junior resident'
  ]) OR designation IS NULL
);
