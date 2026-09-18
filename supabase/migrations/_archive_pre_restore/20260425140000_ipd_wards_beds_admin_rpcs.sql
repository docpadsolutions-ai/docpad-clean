-- IPD ward/bed catalog + admin RPCs (DocPad bed management + admission picker).
-- Safe when tables already exist (adds missing columns).

-- ---------------------------------------------------------------------------
-- ipd_wards
-- ---------------------------------------------------------------------------
create table if not exists public.ipd_wards (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  ward_type text,
  specialty text,
  floor integer,
  code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ipd_wards_hospital_id_idx
  on public.ipd_wards (hospital_id);

create index if not exists ipd_wards_hospital_active_idx
  on public.ipd_wards (hospital_id, is_active);

alter table public.ipd_wards
  add column if not exists ward_type text;

alter table public.ipd_wards
  add column if not exists specialty text;

alter table public.ipd_wards
  add column if not exists floor integer;

alter table public.ipd_wards
  add column if not exists code text;

alter table public.ipd_wards
  add column if not exists is_active boolean;

update public.ipd_wards
set is_active = true
where is_active is null;

alter table public.ipd_wards
  alter column is_active set default true;

alter table public.ipd_wards
  alter column is_active set not null;

-- ---------------------------------------------------------------------------
-- ipd_beds
-- ---------------------------------------------------------------------------
create table if not exists public.ipd_beds (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  ward_id uuid not null references public.ipd_wards (id) on delete cascade,
  bed_number text not null,
  bed_type text,
  status text not null default 'available',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ipd_beds_hospital_id_idx
  on public.ipd_beds (hospital_id);

create index if not exists ipd_beds_ward_id_idx
  on public.ipd_beds (ward_id);

create index if not exists ipd_beds_ward_active_idx
  on public.ipd_beds (ward_id, is_active);

alter table public.ipd_beds
  add column if not exists bed_type text;

alter table public.ipd_beds
  add column if not exists is_active boolean;

alter table public.ipd_beds
  add column if not exists hospital_id uuid;

-- Backfill hospital_id from ward when missing
update public.ipd_beds b
set hospital_id = w.hospital_id
from public.ipd_wards w
where b.ward_id = w.id
  and b.hospital_id is null;

update public.ipd_beds
set is_active = true
where is_active is null;

alter table public.ipd_beds
  alter column is_active set default true;

alter table public.ipd_beds
  alter column is_active set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ipd_beds'
      and column_name = 'hospital_id'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'ipd_beds_hospital_id_fkey'
    ) then
      alter table public.ipd_beds
        add constraint ipd_beds_hospital_id_fkey
        foreign key (hospital_id) references public.organizations (id) on delete cascade;
    end if;
  end if;
exception
  when others then null;
end $$;

comment on table public.ipd_wards is 'Inpatient wards; hospital_id scopes to organizations.';
comment on table public.ipd_beds is 'Inpatient beds; status drives availability for get_bed_availability.';

-- ---------------------------------------------------------------------------
-- RLS (same pattern as departments)
-- ---------------------------------------------------------------------------
alter table public.ipd_wards enable row level security;
alter table public.ipd_beds enable row level security;

drop policy if exists "ipd_wards_hospital_scoped" on public.ipd_wards;
create policy "ipd_wards_hospital_scoped"
on public.ipd_wards
for all
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_wards.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_wards.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

drop policy if exists "ipd_beds_hospital_scoped" on public.ipd_beds;
create policy "ipd_beds_hospital_scoped"
on public.ipd_beds
for all
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_beds.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_beds.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update, delete on public.ipd_wards to authenticated, service_role;
grant select, insert, update, delete on public.ipd_beds to authenticated, service_role;

-- Realtime (ignore if already added)
do $$
begin
  begin
    alter publication supabase_realtime add table public.ipd_beds;
  exception
    when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- upsert_ward
-- ---------------------------------------------------------------------------
create or replace function public.upsert_ward(
  p_hospital_id uuid,
  p_name text,
  p_ward_type text,
  p_specialty text,
  p_floor integer,
  p_ward_id uuid default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_ward_id is null then
    insert into public.ipd_wards (
      hospital_id,
      name,
      ward_type,
      specialty,
      floor,
      is_active
    )
    values (
      p_hospital_id,
      btrim(p_name),
      nullif(btrim(lower(coalesce(p_ward_type, ''))), ''),
      nullif(btrim(coalesce(p_specialty, '')), ''),
      p_floor,
      coalesce(p_is_active, true)
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.ipd_wards w
  set
    name = btrim(p_name),
    ward_type = nullif(btrim(lower(coalesce(p_ward_type, ''))), ''),
    specialty = nullif(btrim(coalesce(p_specialty, '')), ''),
    floor = p_floor,
    is_active = coalesce(p_is_active, true),
    updated_at = now()
  where w.id = p_ward_id
    and w.hospital_id = p_hospital_id;

  if not found then
    raise exception 'ward not found';
  end if;

  return p_ward_id;
end;
$fn$;

comment on function public.upsert_ward(uuid, text, text, text, integer, uuid, boolean) is
  'Admin: insert or update ward metadata.';

revoke all on function public.upsert_ward(uuid, text, text, text, integer, uuid, boolean) from public;
grant execute on function public.upsert_ward(uuid, text, text, text, integer, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_bed
-- ---------------------------------------------------------------------------
create or replace function public.update_bed(
  p_bed_id uuid,
  p_hospital_id uuid,
  p_bed_type text,
  p_status text,
  p_is_active boolean,
  p_bed_number text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_cur text;
begin
  if p_bed_id is null or p_hospital_id is null then
    raise exception 'bed_id and hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  select lower(trim(coalesce(b.status, ''))) into v_cur
  from public.ipd_beds b
  where b.id = p_bed_id
    and b.hospital_id = p_hospital_id
  limit 1;

  if v_cur is null then
    raise exception 'bed not found';
  end if;

  if v_cur = 'occupied' and coalesce(p_is_active, true) = false then
    raise exception 'cannot deactivate occupied bed';
  end if;

  update public.ipd_beds b
  set
    bed_number = coalesce(nullif(btrim(p_bed_number), ''), b.bed_number),
    bed_type = case
      when p_bed_type is null or btrim(p_bed_type) = '' then b.bed_type
      else nullif(btrim(lower(p_bed_type)), '')
    end,
    status = case
      when p_status is null or btrim(p_status) = '' then b.status
      else lower(trim(p_status))
    end,
    is_active = coalesce(p_is_active, true),
    updated_at = now()
  where b.id = p_bed_id
    and b.hospital_id = p_hospital_id;
end;
$fn$;

comment on function public.update_bed(uuid, uuid, text, text, boolean, text) is
  'Admin: update bed attributes; blocks deactivation when occupied.';

revoke all on function public.update_bed(uuid, uuid, text, text, boolean, text) from public;
grant execute on function public.update_bed(uuid, uuid, text, text, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- add_beds_to_ward
-- ---------------------------------------------------------------------------
create or replace function public.add_beds_to_ward(
  p_hospital_id uuid,
  p_ward_id uuid,
  p_count integer,
  p_bed_type text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_whospital uuid;
  i int;
  v_next int;
  v_inserted int := 0;
begin
  if p_hospital_id is null or p_ward_id is null then
    raise exception 'hospital_id and ward_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception 'count must be between 1 and 20';
  end if;

  select w.hospital_id into v_whospital
  from public.ipd_wards w
  where w.id = p_ward_id
  limit 1;

  if v_whospital is null then
    raise exception 'ward not found';
  end if;

  if v_whospital <> p_hospital_id then
    raise exception 'ward does not belong to hospital';
  end if;

  select coalesce(count(*)::integer, 0) into v_next
  from public.ipd_beds
  where ward_id = p_ward_id;

  for i in 1..p_count loop
    v_next := v_next + 1;
    insert into public.ipd_beds (
      hospital_id,
      ward_id,
      bed_number,
      bed_type,
      status,
      is_active
    )
    values (
      p_hospital_id,
      p_ward_id,
      v_next::text,
      nullif(btrim(lower(coalesce(p_bed_type, ''))), ''),
      'available',
      true
    );
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$fn$;

comment on function public.add_beds_to_ward(uuid, uuid, integer, text) is
  'Admin: add numbered beds to a ward (sequential bed_number).';

revoke all on function public.add_beds_to_ward(uuid, uuid, integer, text) from public;
grant execute on function public.add_beds_to_ward(uuid, uuid, integer, text) to authenticated, service_role;
