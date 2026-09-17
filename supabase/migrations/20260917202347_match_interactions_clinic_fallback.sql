-- A doctor with no prescribing history of their own got an empty panel with no
-- explanation, which is indistinguishable from a broken feature. In a small
-- clinic the useful corpus is the clinic's, so when the practitioner has no
-- embeddings at all we widen to their own hospital and say so: every row now
-- carries `scope` ('mine' | 'clinic') and the author's name, and the UI labels
-- clinic rows rather than passing another doctor's prescribing off as the
-- caller's own. Tenant isolation is unchanged - the fallback never leaves the
-- practitioner's hospital.
drop function if exists public.match_interactions(extensions.vector, double precision, integer, uuid);

create function public.match_interactions(
  query_embedding           extensions.vector,
  match_threshold           double precision,
  match_count               integer,
  p_practitioner_id         uuid,
  p_allow_clinic_fallback   boolean default true
) returns table (
  id               uuid,
  source_id        uuid,
  content_text     text,
  interaction_type text,
  similarity       double precision,
  scope            text,
  author_name      text
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with me as (
    select p.id, p.hospital_id
      from practitioners p
     where p.id = p_practitioner_id or p.user_id = p_practitioner_id
     limit 1
  ),
  usable as (
    select e.*
      from doctor_interaction_embeddings e
     where e.interaction_type = 'prescription'
       and e.embedding is not null
       and coalesce(btrim(e.content_text), '') <> ''
       and e.content_text !~ '^Encounter [0-9a-f-]{36}$'
  ),
  mine_count as (
    select count(*) as n from usable u where u.practitioner_id = (select id from me)
  )
  select u.id,
         u.source_id,
         u.content_text,
         u.interaction_type,
         1 - (u.embedding <=> query_embedding) as similarity,
         case when u.practitioner_id = (select id from me) then 'mine' else 'clinic' end as scope,
         pr.full_name as author_name
    from usable u
    left join practitioners pr on pr.id = u.practitioner_id
   where (
           u.practitioner_id = (select id from me)
           or (
             coalesce(p_allow_clinic_fallback, true)
             and (select n from mine_count) = 0
             and u.hospital_id = (select hospital_id from me)
           )
         )
     and 1 - (u.embedding <=> query_embedding) > match_threshold
   order by u.embedding <=> query_embedding
   limit greatest(1, least(coalesce(match_count, 5), 20));
$function$;

comment on function public.match_interactions(extensions.vector, double precision, integer, uuid, boolean) is
  'Nearest past prescriptions: the practitioner''s own, or the clinic''s when they have none yet (scope tells you which). Observed noise floor on gemini-embedding-001 at 768 dimensions is about 0.56 between two unrelated notes, so a useful match_threshold sits above that, around 0.65.';

revoke all on function public.match_interactions(extensions.vector, double precision, integer, uuid, boolean) from public, anon;
grant execute on function public.match_interactions(extensions.vector, double precision, integer, uuid, boolean) to authenticated, service_role;
