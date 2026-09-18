-- Per-hospital feature toggles (UI + integrations). Realtime-enabled for instant client updates.

create table if not exists public.feature_flags (
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  flag_name text not null,
  enabled boolean not null default false,
  updated_by uuid references public.practitioners (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (hospital_id, flag_name)
);

create index if not exists feature_flags_hospital_id_idx
  on public.feature_flags (hospital_id);

comment on table public.feature_flags is
  'Hospital-scoped feature switches; missing row means disabled.';

alter table public.feature_flags replica identity full;

alter table public.feature_flags enable row level security;

-- Any staff in the same hospital can read flags (for UI gating).
create policy "feature_flags_select_same_hospital"
on public.feature_flags
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      and pr.hospital_id = feature_flags.hospital_id
  )
);

-- Inserts: hospital admin only, row must belong to that hospital.
create policy "feature_flags_insert_admin"
on public.feature_flags
for insert
to authenticated
with check (
  public._caller_is_hospital_staff_admin(hospital_id)
);

-- Updates: hospital admin only.
create policy "feature_flags_update_admin"
on public.feature_flags
for update
to authenticated
using (public._caller_is_hospital_staff_admin(hospital_id))
with check (public._caller_is_hospital_staff_admin(hospital_id));

-- Deletes: hospital admin only (optional cleanup).
create policy "feature_flags_delete_admin"
on public.feature_flags
for delete
to authenticated
using (public._caller_is_hospital_staff_admin(hospital_id));

grant select on table public.feature_flags to authenticated;
grant insert, update, delete on table public.feature_flags to authenticated;

do $pub$
begin
  alter publication supabase_realtime add table public.feature_flags;
exception
  when duplicate_object then
    null;
  when others then
    if sqlerrm ilike '%already member%' or sqlerrm ilike '%already in publication%' then
      null;
    else
      raise;
    end if;
end
$pub$;
