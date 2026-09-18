-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803212638.

-- Move pg_trgm from public to extensions schema
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- Move vector from public to extensions schema
ALTER EXTENSION vector SET SCHEMA extensions;
