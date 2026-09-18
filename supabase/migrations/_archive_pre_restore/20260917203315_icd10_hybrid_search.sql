-- ICD-10 suggestion was proposing "Burn of unspecified degree of unspecified knee,
-- sequela" for a note of "Pain of knee region". The model was not at fault: it can
-- only choose from the candidates it is given, and retrieval was handing it burns
-- and prosthetic-loosening codes. Two separate causes.
--
-- 1. HNSW recall. At the default hnsw.ef_search of 40 (and still at 100) the search
--    never reached the right neighbourhood: it returned candidates at similarity
--    0.648 while "Pain in left knee" sits at 0.730. At ef_search 300+ the true top
--    ten comes back exactly. The index is fine; it was being under-searched.
--
-- 2. Dense retrieval alone is weak on short, formulaic label text. Even with exact
--    nearest neighbours, the note "Osteoarthritis" retrieves cartilage tears and
--    prosthetic wear, because every ICD description in this corpus sits in a narrow
--    similarity band. Full-text search over the descriptions returns the M15-M19
--    osteoarthritis codes immediately.
--
-- So: search both ways and hand the model the union. The vector side supplies
-- clinical synonymy ("pain of knee region" to "pain in left knee"), the lexical side
-- anchors on the words the clinician actually wrote.
--
-- ef_search is raised with set_config at call time rather than as a function SET,
-- because setting that parameter on a function is not permitted to this role.

create index if not exists icd10_library_description_fts_idx
  on public.icd10_library
  using gin (to_tsvector('english', long_description));

drop function if exists public.search_icd10(extensions.vector, integer);

create function public.search_icd10(
  query_embedding extensions.vector,
  match_count     integer default 10,
  p_query_text    text default null
) returns table (
  code             text,
  long_description text,
  is_billable      boolean,
  similarity       double precision,
  source           text
)
language plpgsql
stable
set search_path to 'public', 'extensions'
as $function$
declare
  v_n int := greatest(5, least(coalesce(match_count, 10), 25));
begin
  -- Recall, not speed, is what decides whether the suggestion is clinically sane.
  perform set_config('hnsw.ef_search', '400', true);

  return query
  with vec as (
    select l.code, l.long_description, l.is_billable,
           1 - (l.embedding <=> query_embedding) as similarity
      from icd10_library l
     where l.embedding is not null
     order by l.embedding <=> query_embedding
     limit v_n
  ),
  words as (
    select distinct lower(w) as w
      from regexp_split_to_table(coalesce(p_query_text, ''), '[^A-Za-z]+') as w
     where length(w) >= 3
  ),
  lexq as (
    -- Lexemes are [A-Za-z]+ by construction, so they are safe to hand to to_tsquery.
    -- OR, not AND: "pain of knee region" must still match "pain in left knee".
    select to_tsquery('english', string_agg(w || ':*', ' | ')) as q
      from words
    having count(*) > 0
  ),
  lex as (
    select l.code, l.long_description, l.is_billable,
           ts_rank(to_tsvector('english', l.long_description), (select q from lexq))::double precision
             as similarity
      from icd10_library l
     where (select q from lexq) is not null
       and to_tsvector('english', l.long_description) @@ (select q from lexq)
     order by ts_rank(to_tsvector('english', l.long_description), (select q from lexq)) desc,
              l.is_billable desc nulls last,
              length(l.long_description) asc
     limit v_n
  ),
  merged as (
    select v.code, v.long_description, v.is_billable, v.similarity, 'vector'::text as source
      from vec v
    union all
    select x.code, x.long_description, x.is_billable, x.similarity, 'lexical'::text
      from lex x
     where not exists (select 1 from vec v where v.code = x.code)
  )
  select m.code, m.long_description, m.is_billable, m.similarity, m.source
    from merged m
   order by m.source, m.similarity desc;
end;
$function$;

comment on function public.search_icd10(extensions.vector, integer, text) is
  'Hybrid ICD-10 candidate retrieval: HNSW vector neighbours (ef_search 400, because recall at the default was returning burns for knee pain) merged with full-text matches on the description. Pass the clinical note as p_query_text to enable the lexical half.';

revoke all on function public.search_icd10(extensions.vector, integer, text) from public, anon;
grant execute on function public.search_icd10(extensions.vector, integer, text) to authenticated, service_role;
