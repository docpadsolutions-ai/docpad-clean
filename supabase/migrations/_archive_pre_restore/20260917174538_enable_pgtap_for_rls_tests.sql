-- pgTAP, so the multi-tenant isolation rules can be asserted instead of eyeballed.
-- Tests live in supabase/tests/rls_isolation.sql and run inside a rolled-back transaction.
create extension if not exists pgtap with schema extensions;
