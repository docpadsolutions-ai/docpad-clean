-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260410120000.

-- Align with `/api/snomed/search` which filters on `category` (mirror `hierarchy` / picker type).
alter table public.snomed_cache
  add column if not exists category text;
update public.snomed_cache
set category = hierarchy
where category is null and hierarchy is not null;
