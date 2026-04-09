-- Services catalog for hospital revenue / margin tracking; links to charge_items for attribution.
-- hospital_id → public.organizations (DocPad hospital scope).

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  service_code text not null,
  service_name text not null,
  category text not null
    check (
      category in (
        'consultation',
        'procedure',
        'lab_test',
        'imaging',
        'medication',
        'supply',
        'room_charge',
        'nursing',
        'registration'
      )
    ),
  standard_rate numeric(10, 2) not null default 0,
  cost_basis numeric(10, 2),
  is_active boolean not null default true,
  snomed_code text,
  loinc_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists services_hospital_service_code_uq
  on public.services (hospital_id, service_code);

create index if not exists idx_services_hospital_dept
  on public.services (hospital_id, department_id);

comment on table public.services is
  'Hospital service catalog for revenue and margin; optional link to departments.';

comment on column public.services.cost_basis is
  'Internal cost for margin vs standard_rate / billed amounts.';

-- ---------------------------------------------------------------------------
-- RLS (aligned with departments / charge_items: practitioner session hospital)
-- ---------------------------------------------------------------------------
alter table public.services enable row level security;

drop policy if exists "services_hospital_scoped" on public.services;

create policy "services_hospital_scoped"
on public.services
for all
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = services.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = services.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update, delete on public.services to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- charge_items → services
-- ---------------------------------------------------------------------------
alter table public.charge_items
  add column if not exists service_id uuid references public.services (id) on delete set null;

create index if not exists idx_charge_items_service
  on public.charge_items (service_id)
  where service_id is not null;
