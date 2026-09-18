-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803212549.

-- Bulk revoke EXECUTE from anon on ALL functions in public schema
-- This is safe: anon users should never call DocPad functions directly
-- The app always authenticates before calling RPCs
DO $$
DECLARE
  fn_record RECORD;
BEGIN
  FOR fn_record IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT IN ('get_my_hospital_id') -- keep this accessible for RLS
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn_record.proname, fn_record.args);
    EXCEPTION WHEN OTHERS THEN
      -- Skip if function doesn't have anon grant
      NULL;
    END;
  END LOOP;
END;
$$;

-- Fix search_path on all public functions that are missing it
-- Set search_path = public for all functions in the public schema
DO $$
DECLARE
  fn_record RECORD;
BEGIN
  FOR fn_record IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public', fn_record.proname, fn_record.args);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;
