-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260920070955.

create table if not exists public.encounter_drafts (
  encounter_id uuid primary key references public.opd_encounters(id) on delete cascade,
  hospital_id  uuid not null references public.organizations(id),
  draft        jsonb not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

create index if not exists encounter_drafts_hospital_idx
  on public.encounter_drafts (hospital_id, updated_at desc);

alter table public.encounter_drafts enable row level security;

drop policy if exists encounter_drafts_select on public.encounter_drafts;
create policy encounter_drafts_select on public.encounter_drafts
  for select using (hospital_id = (select auth_hospital_id()));

create or replace function public.save_encounter_draft(
  p_encounter_id uuid,
  p_draft jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hospital uuid;
  v_status text;
  v_now timestamptz;
begin
  select e.hospital_id, e.status into v_hospital, v_status
    from public.opd_encounters e
   where e.id = p_encounter_id;

  if not found then
    raise exception 'Encounter not found';
  end if;

  if v_hospital is distinct from (select auth_hospital_id()) then
    raise exception 'Not authorised for this encounter' using errcode = '42501';
  end if;

  if v_status = 'completed' then
    raise exception 'Encounter is finalised' using errcode = '42501';
  end if;

  v_now := now();

  insert into public.encounter_drafts (encounter_id, hospital_id, draft, updated_at, updated_by)
  values (p_encounter_id, v_hospital, p_draft, v_now, auth.uid())
  on conflict (encounter_id) do update
    set draft = excluded.draft,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return v_now;
end;
$$;

grant execute on function public.save_encounter_draft(uuid, jsonb) to authenticated;

create or replace function public.get_encounter_draft(p_encounter_id uuid)
returns table (draft jsonb, updated_at timestamptz, updated_by uuid)
language sql
stable
security definer
set search_path = public
as $$
  select d.draft, d.updated_at, d.updated_by
    from public.encounter_drafts d
   where d.encounter_id = p_encounter_id
     and d.hospital_id = (select auth_hospital_id());
$$;

grant execute on function public.get_encounter_draft(uuid) to authenticated;

create or replace function public.clear_encounter_draft(p_encounter_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.encounter_drafts d
   where d.encounter_id = p_encounter_id
     and d.hospital_id = (select auth_hospital_id());
end;
$$;

grant execute on function public.clear_encounter_draft(uuid) to authenticated;
