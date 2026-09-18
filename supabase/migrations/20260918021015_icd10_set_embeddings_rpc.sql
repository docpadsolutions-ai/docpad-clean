-- Batch writer for the embedding backfill. Without it the script would have to PATCH
-- one row per code (15,347 round trips); this takes a page of rows at a time.
-- service_role only: it is an ingest utility, not part of the application surface.
create or replace function public._icd10_set_embeddings(p_rows jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
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
     set embedding = i.embedding
    from incoming i
   where l.id = i.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public._icd10_set_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public._icd10_set_embeddings(jsonb) to service_role;

comment on function public._icd10_set_embeddings(jsonb) is
  'Ingest utility for scripts/backfill-icd10-embeddings.mjs. Safe to drop once the ICD-10 library is fully embedded.';
