-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917192250.

-- Two helpers were created without a pinned search_path (Supabase lint
-- function_search_path_mutable). Neither is SECURITY DEFINER, so the exposure is
-- small, but an unpinned search_path lets a caller's own schema shadow an
-- operator or function these bodies rely on.
alter function public._duration_to_days(text) set search_path to 'public';
alter function public._uuid_or_null(text) set search_path to 'public';
