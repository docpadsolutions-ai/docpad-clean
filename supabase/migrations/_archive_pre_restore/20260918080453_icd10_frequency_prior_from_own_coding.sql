-- A clinic's real diagnostic vocabulary is small: a couple of hundred codes will
-- cover almost every OPD visit. Once a code has been used here for a given wording,
-- that is far better evidence than any retrieval, and it is free to consult.
--
-- This reads what has actually been coded on finished encounters rather than keeping
-- a separate counter, so it cannot drift out of step with the record, and it needs no
-- write path of its own. Scoped to the caller's hospital; the doctor's own history is
-- ranked above a colleague's but both count, because in a two-doctor clinic one
-- doctor's history is most of the signal there is.
--
-- Superseded within the same session by 20260918080554, which adds explicit scope
-- arguments so the Edge Function (which runs as service_role, where auth_hospital_id()
-- is null) can use it. Kept so the history reads in order.
create or replace function public.icd10_prior_for_note(
  p_query_text text,
  p_limit      integer default 5
) returns table (
  code             text,
  long_description text,
  times_used       integer,
  last_used        timestamptz,
  by_me            boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_hospital uuid := auth_hospital_id();
  v_me       uuid;
begin
  if v_hospital is null or coalesce(btrim(p_query_text), '') = '' then
    return;
  end if;

  select p.id into v_me from practitioners p where p.user_id = auth.uid() limit 1;

  return query
  with terms as (select t.lexeme from public._icd10_query_terms(p_query_text) t),
  used as (
    select e.diagnosis_icd10 as code,
           coalesce(e.diagnosis_term, e.working_diagnosis) as wording,
           e.doctor_id,
           e.updated_at
      from opd_encounters e
     where e.hospital_id = v_hospital
       and coalesce(e.diagnosis_icd10, '') <> ''
  ),
  matched as (
    select u.code,
           count(*)::integer as times_used,
           max(u.updated_at) as last_used,
           bool_or(u.doctor_id = v_me) as by_me,
           max((
             select count(*) from terms t
              where to_tsvector('english', coalesce(u.wording, '')) @@ to_tsquery('english', t.lexeme || ':*')
           )) as hits
      from used u
     group by u.code
  )
  select m.code,
         l.long_description,
         m.times_used,
         m.last_used,
         m.by_me
    from matched m
    join icd10_library l on l.code = m.code
   where m.hits > 0
   order by m.by_me desc, m.hits desc, m.times_used desc, m.last_used desc
   limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$function$;

revoke all on function public.icd10_prior_for_note(text, integer) from public, anon;
grant execute on function public.icd10_prior_for_note(text, integer) to authenticated, service_role;
