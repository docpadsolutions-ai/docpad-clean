-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917174538.

-- pgTAP, so the multi-tenant isolation rules can be asserted instead of eyeballed.
-- Tests live in supabase/tests/rls_isolation.sql and run inside a rolled-back transaction.
create extension if not exists pgtap with schema extensions;
