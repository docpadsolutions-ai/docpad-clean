-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205103.

-- Helper function for RLS policies: returns the current user's hospital_id
-- STABLE + SECURITY DEFINER allows Postgres to cache result within a transaction
-- This replaces repeated subqueries in RLS policies for significant performance gain
CREATE OR REPLACE FUNCTION public.get_my_hospital_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.get_my_hospital_id() TO authenticated;

COMMENT ON FUNCTION public.get_my_hospital_id() IS 
  'Returns the hospital_id for the currently authenticated user. Used in RLS policies to avoid repeated subqueries on practitioners table.';
