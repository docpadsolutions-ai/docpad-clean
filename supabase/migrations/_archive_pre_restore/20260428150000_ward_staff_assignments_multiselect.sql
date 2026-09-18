-- Ward ↔ nurse assignments: date range (inclusive) + multi-ward + soft delete (is_active).

create table if not exists public.ward_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  ward_id uuid not null references public.ipd_wards (id) on delete cascade,
  shift text not null,
  start_date date not null,
  end_date date not null,
  assigned_by uuid references public.practitioners (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ward_staff_assignments
  add column if not exists is_active boolean;

update public.ward_staff_assignments
set is_active = true
where is_active is null;

alter table public.ward_staff_assignments
  alter column is_active set default true;

alter table public.ward_staff_assignments
  alter column is_active set not null;

create unique index if not exists ward_staff_assignments_practitioner_ward_shift_range_uidx
  on public.ward_staff_assignments (practitioner_id, ward_id, shift, start_date, end_date);
