-- The similar-prescriptions panel had three problems beyond the search_path break:
--
--  * the function returned no id, so the client had no stable key for a row;
--  * p_practitioner_id had to be the practitioners.id exactly, while callers
--    elsewhere in the app pass an auth user id just as often;
--  * rows whose content_text is the placeholder the embedder writes when an
--    encounter had no prescription text ("Encounter <uuid>") were returned as
--    suggestions, so the doctor was offered cards with nothing in them.
drop function if exists public.match_interactions(extensions.vector, double precision, integer, uuid);

create function public.match_interactions(
  query_embedding    extensions.vector,
  match_threshold    double precision,
  match_count        integer,
  p_practitioner_id  uuid
) returns table (
  id               uuid,
  source_id        uuid,
  content_text     text,
  interaction_type text,
  similarity       double precision
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with me as (
    select p.id
      from practitioners p
     where p.id = p_practitioner_id or p.user_id = p_practitioner_id
     limit 1
  )
  select e.id,
         e.source_id,
         e.content_text,
         e.interaction_type,
         1 - (e.embedding <=> query_embedding) as similarity
    from doctor_interaction_embeddings e
   where e.practitioner_id = (select id from me)
     and e.interaction_type = 'prescription'
     and e.embedding is not null
     and coalesce(btrim(e.content_text), '') <> ''
     and e.content_text !~ '^Encounter [0-9a-f-]{36}$'
     and 1 - (e.embedding <=> query_embedding) > match_threshold
   order by e.embedding <=> query_embedding
   limit greatest(1, least(coalesce(match_count, 5), 20));
$function$;

comment on function public.match_interactions(extensions.vector, double precision, integer, uuid) is
  'Nearest past prescriptions by this practitioner. Observed noise floor on gemini-embedding-001 at 768 dimensions is about 0.56 (any two unrelated notes), so a useful match_threshold sits above that, around 0.65.';

revoke all on function public.match_interactions(extensions.vector, double precision, integer, uuid) from public, anon;
grant execute on function public.match_interactions(extensions.vector, double precision, integer, uuid) to authenticated, service_role;
