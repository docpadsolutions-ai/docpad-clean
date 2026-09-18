-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917200934.

-- The security pass pinned `search_path = public` on every function (Supabase lint
-- function_search_path_mutable). For the three functions that do vector search that
-- was wrong: pgvector lives in the `extensions` schema, so pinning the path to
-- `public` alone hid the `<=>` operator and every call failed with
--
--   42883: operator does not exist: extensions.vector <=> extensions.vector
--
-- which is why the ICD-10 suggestion and the similar-prescriptions panel had been
-- returning errors and empty results. `extensions` is appended, not substituted, so
-- the path is still pinned and the lint stays satisfied.
alter function public.search_icd10(extensions.vector, integer)
  set search_path to 'public', 'extensions';

alter function public.match_interactions(extensions.vector, double precision, integer, uuid)
  set search_path to 'public', 'extensions';

alter function public.get_similar_interactions(uuid, extensions.vector, text, integer)
  set search_path to 'public', 'extensions';
