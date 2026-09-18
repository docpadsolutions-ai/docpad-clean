-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260918080554.

-- The Edge Function calls with the service key, where auth_hospital_id() is null, so
-- it has to be able to pass the scope it already established when it authenticated
-- the caller. Staff sessions keep working without arguments.
create or replace function public.icd10_prior_for_note(
  p_query_text      text,
  p_limit           integer default 5,
  p_hospital_id     uuid default null,
  p_practitioner_id uuid default null
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
  v_hospital uuid := coalesce(p_hospital_id, auth_hospital_id());
  v_me       uuid;
begin
  if v_hospital is null or coalesce(btrim(p_query_text), '') = '' then
    return;
  end if;

  -- A caller passing a hospital must be entitled to it; a staff session is already
  -- scoped by auth_hospital_id() and this is a no-op for it.
  if p_hospital_id is not null then
    perform public._assert_hospital_scope('hospital', p_hospital_id);
  end if;

  select p.id into v_me
    from practitioners p
   where p.id = coalesce(p_practitioner_id, auth.uid())
      or p.user_id = coalesce(p_practitioner_id, auth.uid())
   limit 1;

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

drop function if exists public.icd10_prior_for_note(text, integer);

revoke all on function public.icd10_prior_for_note(text, integer, uuid, uuid) from public, anon;
grant execute on function public.icd10_prior_for_note(text, integer, uuid, uuid) to authenticated, service_role;

comment on function public.icd10_prior_for_note(text, integer, uuid, uuid) is
  'Codes this hospital has already used for wording like the note, the doctor''s own first. Read straight off finished encounters, so it needs no counter of its own and cannot drift from the record.';
