-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409145311.

-- Remove feature flags table and all related functions/policies

-- Drop function
DROP FUNCTION IF EXISTS public.set_feature_flag_for_hospital(uuid, text, boolean);

-- Drop RLS policies
DROP POLICY IF EXISTS "Hospital admins can manage feature flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Hospital staff can view feature flags" ON public.feature_flags;

-- Drop table
DROP TABLE IF EXISTS public.feature_flags CASCADE;
