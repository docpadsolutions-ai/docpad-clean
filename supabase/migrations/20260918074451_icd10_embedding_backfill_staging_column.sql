-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260918074451.

-- The first backfill attempt died on "canceling statement due to statement timeout".
-- Measured cause, not guessed: updating 50 rows of icd10_library takes 13.7 seconds,
-- of which 0.16s is finding the rows and the rest is HNSW index maintenance, about
-- 274ms per row on this instance. PostgREST runs as authenticator with
-- statement_timeout=8s, so every write batch was killed.
--
-- Dropping the index for the duration was the obvious fix and is wrong here: without
-- it the nearest-neighbour query falls back to a sequential scan that measures 30
-- seconds on this instance, so ICD-10 suggestion would be dead for the hours the
-- backfill takes rather than degraded.
--
-- So embeddings land in an unindexed staging column first, where writes cost
-- milliseconds and search is untouched. A second migration merges the column into
-- `embedding` and rebuilds the index once, which is both faster than 15,347
-- incremental inserts and produces a better-connected graph than the incremental
-- build we currently have (the reason ef_search has to be 400).
alter table public.icd10_library
  add column if not exists embedding_pending extensions.vector(768);

comment on column public.icd10_library.embedding_pending is
  'Staging for the embedding backfill: deliberately unindexed so writes do not pay HNSW maintenance. Merged into embedding and dropped once the backfill completes.';

create or replace function public._icd10_set_embeddings(p_rows jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
-- Headroom over the 8s authenticator default. Writes to the unindexed staging column
-- are milliseconds; this is only so a slow moment cannot kill a batch mid-run.
set statement_timeout to '120s'
as $function$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of {id, embedding}' using errcode = '22023';
  end if;

  with incoming as (
    select (e->>'id')::uuid as id,
           (e->>'embedding')::extensions.vector as embedding
      from jsonb_array_elements(p_rows) e
     where e ? 'id' and e ? 'embedding'
  )
  update icd10_library l
     set embedding_pending = i.embedding
    from incoming i
   where l.id = i.id
     and l.embedding is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public._icd10_set_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public._icd10_set_embeddings(jsonb) to service_role;

comment on function public._icd10_set_embeddings(jsonb) is
  'Ingest utility for scripts/backfill-icd10-embeddings.mjs. Writes to the unindexed embedding_pending column; a later migration merges it into embedding and rebuilds the index.';

-- What the script selects and counts against, so a resumed run skips rows already
-- staged as well as rows already embedded.
create or replace view public.icd10_awaiting_embedding as
select id, code, long_description
  from public.icd10_library
 where embedding is null and embedding_pending is null;

revoke all on public.icd10_awaiting_embedding from public, anon, authenticated;
grant select on public.icd10_awaiting_embedding to service_role;
