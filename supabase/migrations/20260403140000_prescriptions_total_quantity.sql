-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260403140000.

-- Total dispensable units per Rx line (frequency × duration / 1-0-1 parsing in app)
alter table public.prescriptions add column if not exists total_quantity integer not null default 1;
