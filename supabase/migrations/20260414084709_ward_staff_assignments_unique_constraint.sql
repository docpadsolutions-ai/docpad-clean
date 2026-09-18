-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414084709.

CREATE UNIQUE INDEX uq_ward_staff_assignment 
ON public.ward_staff_assignments (practitioner_id, ward_id, assigned_date, shift);
