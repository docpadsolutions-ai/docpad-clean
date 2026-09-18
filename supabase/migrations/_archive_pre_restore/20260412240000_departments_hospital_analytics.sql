-- Department dimension for hospital-scoped analytics (billing, encounters, practitioners).
-- DocPad uses public.organizations as the hospital row (practitioners.hospital_id → organizations.id).

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  code text,
  type text not null
    check (type in ('clinical', 'diagnostic', 'administrative', 'support')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists departments_hospital_id_idx
  on public.departments (hospital_id);

create index if not exists departments_hospital_active_idx
  on public.departments (hospital_id, is_active);

comment on table public.departments is
  'Hospital departments for analytics and attribution; hospital_id scopes to organizations.';

comment on column public.departments.code is
  'Short code, e.g. ORTHO, CARDIO.';

-- ---------------------------------------------------------------------------
-- RLS: same hospital as the signed-in practitioner row
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;

drop policy if exists "departments_hospital_scoped" on public.departments;

-- Intended rule: hospital_id = practitioner.hospital_id for auth.uid().
-- Extended to match existing billing RLS: practitioners.user_id = auth.uid() OR practitioners.id = auth.uid().
create policy "departments_hospital_scoped"
on public.departments
for all
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = departments.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = departments.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update, delete on public.departments to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- FK columns (nullable; set as data is attributed)
-- ---------------------------------------------------------------------------
alter table public.charge_items
  add column if not exists department_id uuid references public.departments (id) on delete set null;

alter table public.invoices
  add column if not exists department_id uuid references public.departments (id) on delete set null;

alter table public.opd_encounters
  add column if not exists department_id uuid references public.departments (id) on delete set null;

alter table public.practitioners
  add column if not exists primary_department_id uuid references public.departments (id) on delete set null;

create index if not exists charge_items_department_id_idx
  on public.charge_items (department_id)
  where department_id is not null;

create index if not exists invoices_department_id_idx
  on public.invoices (department_id)
  where department_id is not null;

create index if not exists opd_encounters_department_id_idx
  on public.opd_encounters (department_id)
  where department_id is not null;

create index if not exists practitioners_primary_department_id_idx
  on public.practitioners (primary_department_id)
  where primary_department_id is not null;

-- ---------------------------------------------------------------------------
-- Seed for DocPad Health Clinic (organizations.name — not a separate hospitals table)
-- ---------------------------------------------------------------------------
with target_orgs as (
  select id as hospital_id
  from public.organizations
  where coalesce(nullif(trim(name), ''), '') = 'DocPad Health Clinic'
),
seed (name, code, type) as (
  values
    ('Orthopedics', 'ORTHO', 'clinical'),
    ('General Medicine', 'GENMED', 'clinical'),
    ('Diagnostics', 'DIAG', 'diagnostic'),
    ('Pharmacy', 'PHARM', 'support'),
    ('Administration', 'ADMIN', 'administrative')
)
insert into public.departments (hospital_id, name, code, type)
select t.hospital_id, s.name, s.code, s.type
from target_orgs t
cross join seed s
where not exists (
  select 1
  from public.departments d
  where d.hospital_id = t.hospital_id
    and d.code is not distinct from s.code
);
