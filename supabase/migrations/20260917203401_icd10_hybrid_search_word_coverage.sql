-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917203401.

-- ts_rank was the wrong ranking for the lexical half. Scoring by OR-query relevance
-- let one rare word dominate: "Pain of knee region" surfaced lumbar disc degeneration
-- and complex regional pain syndrome, because "region" is rarer than "knee". What
-- matters for picking a code is how many of the clinician's words a description
-- actually covers, then how specific that description is. Rank by coverage instead,
-- and report it as a 0-1 fraction so the number means something.
create or replace function public.search_icd10(
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
  word_count as (select count(*)::double precision as n from words),
  lexq as (
    -- Lexemes are [A-Za-z]+ by construction, so they are safe to hand to to_tsquery.
    -- OR, not AND: "pain of knee region" must still match "pain in left knee".
    select to_tsquery('english', string_agg(w || ':*', ' | ')) as q
      from words
    having count(*) > 0
  ),
  lex_hits as (
    select l.code, l.long_description, l.is_billable,
           to_tsvector('english', l.long_description) as tv
      from icd10_library l
     where (select q from lexq) is not null
       and to_tsvector('english', l.long_description) @@ (select q from lexq)
  ),
  lex as (
    select h.code, h.long_description, h.is_billable,
           (
             select count(*) from words w
              where h.tv @@ to_tsquery('english', w.w || ':*')
           )::double precision / nullif((select n from word_count), 0) as similarity
      from lex_hits h
     order by similarity desc,
              h.is_billable desc nulls last,
              length(h.long_description) asc
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
