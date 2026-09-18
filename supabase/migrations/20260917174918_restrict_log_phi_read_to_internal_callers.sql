-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917174918.

-- log_phi_read is only ever called from inside SECURITY DEFINER RPCs (which run as the owner),
-- so no client role needs EXECUTE on it. Leaving it open would let anyone forge audit entries.
revoke execute on function public.log_phi_read(text, uuid) from anon, authenticated;
