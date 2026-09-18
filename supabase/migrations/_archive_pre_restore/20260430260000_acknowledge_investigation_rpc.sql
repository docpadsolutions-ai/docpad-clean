-- Single entry point for acknowledging investigations: audit row + investigation updates.

alter table public.investigation_acknowledgements
  add column if not exists notes text;

alter table public.investigation_acknowledgements
  add column if not exists action_taken text;

create or replace function public.acknowledge_investigation (
  p_investigation_id uuid,
  p_notes text default null,
  p_reason text default null,
  p_action_taken text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_practitioner_id uuid;
  v_reason text;
  v_updated uuid;
begin
  if p_investigation_id is null then
    raise exception 'p_investigation_id is required';
  end if;

  select p.id
  into v_practitioner_id
  from public.practitioners p
  where p.user_id = auth.uid()
  limit 1;

  if v_practitioner_id is null then
    raise exception 'No practitioner profile for current user';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'result_review');
  if v_reason not in ('result_review', 'sla_pipeline') then
    raise exception 'Invalid p_reason';
  end if;

  if not exists (
    select 1
    from public.investigations inv
    where inv.id = p_investigation_id
  ) then
    raise exception 'Investigation not found';
  end if;

  if v_reason = 'result_review' then
    update public.investigations inv
    set
      reviewed_at = now(),
      reviewed_by = v_practitioner_id,
      acknowledged_at = now()
    where inv.id = p_investigation_id
    returning inv.id into v_updated;
  else
    update public.investigations inv
    set sla_acknowledged_at = now()
    where inv.id = p_investigation_id
    returning inv.id into v_updated;
  end if;

  if v_updated is null then
    raise exception 'Could not update investigation';
  end if;

  insert into public.investigation_acknowledgements (
    investigation_id,
    practitioner_id,
    reason,
    notes,
    action_taken
  )
  values (
    p_investigation_id,
    v_practitioner_id,
    v_reason,
    nullif(trim(p_notes), ''),
    nullif(trim(p_action_taken), '')
  );
end;
$function$;

comment on function public.acknowledge_investigation (uuid, text, text, text) is
  'Acknowledges an investigation: updates investigations per reason, inserts investigation_acknowledgements. Practitioner resolved from auth.uid().';

grant execute on function public.acknowledge_investigation (uuid, text, text, text) to authenticated;

revoke all on function public.acknowledge_investigation (uuid, text, text, text) from public;
