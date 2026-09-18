-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409062854.

-- Use TRUNCATE CASCADE to auto-handle dependencies
-- Much cleaner than manual DELETE ordering

-- Truncate all patient-related data (cascades to all dependent tables)
TRUNCATE patients CASCADE;

-- Truncate appointments and encounters separately (in case not caught by CASCADE)
TRUNCATE appointments CASCADE;
TRUNCATE opd_encounters CASCADE;
TRUNCATE reception_queue CASCADE;

-- Keep only admin practitioner (can't use TRUNCATE here - need WHERE clause)
DELETE FROM practitioners 
WHERE user_id != '69630706-05ab-4163-a333-e2f4d01387cb';
