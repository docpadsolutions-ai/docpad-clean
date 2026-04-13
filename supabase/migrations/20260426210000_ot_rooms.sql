-- Operation theatres catalog (Schedule Surgery picker + Admin).
create table if not exists public.ot_rooms (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  ot_number text not null,
  specialty text,
  floor integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ot_rooms_hospital_ot_number_uidx
  on public.ot_rooms (hospital_id, ot_number);

create index if not exists ot_rooms_hospital_active_idx
  on public.ot_rooms (hospital_id, is_active);

comment on table public.ot_rooms is 'Operation theatre rooms; ot_number is the stable label stored on surgeries.';

alter table public.ot_rooms enable row level security;

drop policy if exists "ot_rooms_hospital_scoped" on public.ot_rooms;
create policy "ot_rooms_hospital_scoped"
on public.ot_rooms
for all
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ot_rooms.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ot_rooms.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update, delete on public.ot_rooms to authenticated, service_role;
