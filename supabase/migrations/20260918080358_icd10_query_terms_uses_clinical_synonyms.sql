-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260918080358.

-- Fold the vocabulary layer into query term extraction. A synonym phrase matches on
-- whole-word boundaries (so "mi" does not fire inside "mild"), and its expansion is
-- appended to the note rather than replacing anything: "senile cataract" ends up
-- searching senile, cataract, age and related, and the IDF weighting decides which
-- of those actually discriminate.
create or replace function public._icd10_query_terms(p_text text)
returns table (lexeme text, idf double precision)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_total    double precision;
  v_expanded text;
begin
  select count(*)::double precision into v_total from icd10_library;

  select p_text || coalesce(' ' || string_agg(s.expansion, ' '), '')
    into v_expanded
    from clinical_synonyms s
   where coalesce(p_text, '') <> ''
     and lower(p_text) ~ ('\m' || regexp_replace(lower(s.phrase), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M');

  v_expanded := coalesce(v_expanded, p_text);

  return query
  with raw as (
    select distinct lower(w) as w
      from regexp_split_to_table(coalesce(v_expanded, ''), '[^A-Za-z]+') as w
     where length(w) >= 3
  ),
  variants as (
    select r.w, v.cand, v.rank
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
  ),
  deduped as (select distinct lx from resolved)
  select d.lx,
         ln(v_total / (1 + coalesce(
           (select sum(f.ndoc)::double precision from icd10_lexeme_df f where f.lexeme like d.lx || '%'),
           0)))
    from deduped d;
end;
$function$;

revoke all on function public._icd10_query_terms(text) from public, anon;
grant execute on function public._icd10_query_terms(text) to authenticated, service_role;
