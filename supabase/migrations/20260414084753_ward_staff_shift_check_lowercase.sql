-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414084753.

ALTER TABLE public.ward_staff_assignments 
DROP CONSTRAINT ward_staff_assignments_shift_check;

ALTER TABLE public.ward_staff_assignments
ADD CONSTRAINT ward_staff_assignments_shift_check 
CHECK (lower(shift) = ANY (ARRAY['morning','afternoon','night','general']));
