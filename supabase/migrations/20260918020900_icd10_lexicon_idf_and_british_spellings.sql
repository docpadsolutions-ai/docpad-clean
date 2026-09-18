-- Two weaknesses in the lexical half of ICD-10 retrieval, both of which matter more
-- than usual here because 15,347 codes (all of chapters F, H, O, P, Q, U, V, W, X, Y)
-- have no embedding yet and are reachable ONLY through this path.
--
-- 1. Every matched word counted the same, so "Senile cataract of right eye" ranked
--    "Senile ectropion of right upper eyelid" level with the cataract codes: both
--    matched two of three words. Weighting by inverse document frequency makes
--    "cataract" count for far more than "right" or "eye", which is what a coder
--    would do.
--
-- 2. Indian clinical English is British. "Anaemia" does not appear anywhere in the
--    ICD library, which spells it "anemia"; the same goes for oedema, diarrhoea,
--    haemorrhage, tumour, paediatric, anaesthesia. Rather than a blanket regex
--    (which would turn "toe" into "te"), a variant is only used when the word as
--    typed is absent from the corpus lexicon and the variant is present.

-- Document frequency over every ICD description, for the IDF weighting.
drop materialized view if exists public.icd10_lexeme_df;
create materialized view public.icd10_lexeme_df as
select word as lexeme, ndoc
  from ts_stat($$select to_tsvector('english', long_description) from public.icd10_library$$);

create unique index if not exists icd10_lexeme_df_lexeme_idx on public.icd10_lexeme_df (lexeme);
create index if not exists icd10_lexeme_df_lexeme_prefix_idx
  on public.icd10_lexeme_df (lexeme text_pattern_ops);

revoke all on public.icd10_lexeme_df from public, anon;
grant select on public.icd10_lexeme_df to authenticated, service_role;

comment on materialized view public.icd10_lexeme_df is
  'Lexeme document frequency over icd10_library.long_description. Refresh after changing the code library: refresh materialized view concurrently public.icd10_lexeme_df;';

-- The lexeme a word stems to, plus its IDF, with a British-to-American fallback
-- applied only when the word as typed is not in the corpus lexicon.
create or replace function public._icd10_query_terms(p_text text)
returns table (lexeme text, idf double precision)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_total double precision;
begin
  select count(*)::double precision into v_total from icd10_library;

  return query
  with raw as (
    select distinct lower(w) as w
      from regexp_split_to_table(coalesce(p_text, ''), '[^A-Za-z]+') as w
     where length(w) >= 3
  ),
  variants as (
    select r.w,
           v.cand,
           v.rank
      from raw r
      cross join lateral (
        values
          (r.w, 0),
          (replace(r.w, 'ae', 'e'), 1),
          (replace(r.w, 'oe', 'e'), 2),
          (replace(r.w, 'our', 'or'), 3),
          (replace(r.w, 'isation', 'ization'), 4),
          (replace(r.w, 'ise', 'ize'), 5),
          (replace(r.w, 'yse', 'yze'), 6),
          (replace(r.w, 'll', 'l'), 7)
      ) as v(cand, rank)
  ),
  stemmed as (
    select v.w, v.rank, v.cand,
           (select s.lexeme from unnest(to_tsvector('english', v.cand)) as s limit 1) as lx
      from variants v
  ),
  resolved as (
    select distinct on (s.w) s.w, s.lx
      from stemmed s
     where s.lx is not null
       and exists (select 1 from icd10_lexeme_df d where d.lexeme like s.lx || '%')
     order by s.w, s.rank
  )
  select r.lx,
         ln(v_total / (1 + coalesce(
           (select sum(d.ndoc)::double precision from icd10_lexeme_df d where d.lexeme like r.lx || '%'),
           0)))
    from resolved r;
end;
$function$;

revoke all on function public._icd10_query_terms(text) from public, anon;
grant execute on function public._icd10_query_terms(text) to authenticated, service_role;

-- Hybrid retrieval, lexical half now IDF-weighted.
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
  terms as (select t.lexeme, t.idf from public._icd10_query_terms(p_query_text) t),
  total_idf as (select nullif(sum(idf), 0) as s from terms),
  lexq as (
    select to_tsquery('english', string_agg(lexeme || ':*', ' | ')) as q
      from terms
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
           coalesce((
             select sum(t.idf) from terms t
              where exists (
                select 1 from unnest(tsvector_to_array(h.tv)) as a
                 where a like t.lexeme || '%'
              )
           ), 0) / (select s from total_idf) as similarity
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
