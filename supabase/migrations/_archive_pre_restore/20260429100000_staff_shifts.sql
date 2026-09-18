-- Per-practitioner shift templates (e.g. "General") for admin Performance tab + attendance context.

create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  shift_name text not null default 'General',
  shift_start time not null default '09:00'::time,
  shift_end time not null default '17:00'::time,
  -- ISO weekday: 1 = Monday … 7 = Sunday
  working_days smallint[] not null default '{1,2,3,4,5}',
  grace_period_minutes integer not null default 15
    check (grace_period_minutes >= 0 and grace_period_minutes <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practitioner_id, shift_name)
);

create index if not exists staff_shifts_hospital_idx on public.staff_shifts (hospital_id);
create index if not exists staff_shifts_practitioner_idx on public.staff_shifts (practitioner_id);

alter table public.staff_shifts enable row level security;

drop policy if exists staff_shifts_select on public.staff_shifts;
create policy staff_shifts_select
  on public.staff_shifts for select
  to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = staff_shifts.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

drop policy if exists staff_shifts_admin_insert on public.staff_shifts;
create policy staff_shifts_admin_insert
  on public.staff_shifts for insert
  to authenticated
  with check (public._caller_is_hospital_staff_admin(hospital_id));

drop policy if exists staff_shifts_admin_update on public.staff_shifts;
create policy staff_shifts_admin_update
  on public.staff_shifts for update
  to authenticated
  using (public._caller_is_hospital_staff_admin(hospital_id))
  with check (public._caller_is_hospital_staff_admin(hospital_id));

grant select, insert, update on public.staff_shifts to authenticated;
grant all on public.staff_shifts to service_role;

create or replace function public.staff_shifts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_shifts_set_updated_at on public.staff_shifts;
create trigger staff_shifts_set_updated_at
  before update on public.staff_shifts
  for each row
  execute function public.staff_shifts_touch_updated_at();

comment on table public.staff_shifts is
  'Shift template per practitioner (e.g. General) — working hours, days, grace for attendance.';
