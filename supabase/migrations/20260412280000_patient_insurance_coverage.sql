-- Payer catalog + per-patient coverage (insurance card OCR flow).

-- ---------------------------------------------------------------------------
-- insurance_companies (hospital-scoped payer names for fuzzy match)
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_companies (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists insurance_companies_hospital_name_lower_uq
  on public.insurance_companies (hospital_id, lower(trim(name)));

create index if not exists insurance_companies_hospital_active_idx
  on public.insurance_companies (hospital_id, is_active);

comment on table public.insurance_companies is
  'Hospital directory of insurance payers; OCR insurance_name is fuzzy-matched here.';

-- ---------------------------------------------------------------------------
-- patient_insurance_coverage
-- ---------------------------------------------------------------------------
create table if not exists public.patient_insurance_coverage (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  insurance_company_id uuid references public.insurance_companies (id) on delete set null,
  insurance_name_raw text,
  policy_number text,
  member_id text,
  valid_until date,
  remaining_balance numeric(14, 2),
  coverage_limit numeric(14, 2),
  front_image_path text,
  back_image_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_insurance_coverage_patient_idx
  on public.patient_insurance_coverage (patient_id, created_at desc);

create index if not exists patient_insurance_coverage_hospital_idx
  on public.patient_insurance_coverage (hospital_id);

comment on table public.patient_insurance_coverage is
  'Insurance card capture + OCR; remaining_balance/coverage_limit for eligibility display.';

comment on column public.patient_insurance_coverage.remaining_balance is
  'Benefit balance or copay wallet; set manually or from eligibility API later.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.insurance_companies enable row level security;
alter table public.patient_insurance_coverage enable row level security;

drop policy if exists "insurance_companies_select_practitioner_hospital" on public.insurance_companies;
drop policy if exists "insurance_companies_insert_practitioner_hospital" on public.insurance_companies;
drop policy if exists "insurance_companies_update_practitioner_hospital" on public.insurance_companies;

create policy "insurance_companies_select_practitioner_hospital"
on public.insurance_companies
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = insurance_companies.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_companies_insert_practitioner_hospital"
on public.insurance_companies
for insert
to authenticated
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = insurance_companies.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_companies_update_practitioner_hospital"
on public.insurance_companies
for update
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = insurance_companies.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = insurance_companies.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

drop policy if exists "patient_insurance_select_practitioner_hospital" on public.patient_insurance_coverage;
drop policy if exists "patient_insurance_insert_practitioner_hospital" on public.patient_insurance_coverage;
drop policy if exists "patient_insurance_update_practitioner_hospital" on public.patient_insurance_coverage;

create policy "patient_insurance_select_practitioner_hospital"
on public.patient_insurance_coverage
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = patient_insurance_coverage.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
  and exists (select 1 from public.patients p where p.id = patient_insurance_coverage.patient_id)
);

create policy "patient_insurance_insert_practitioner_hospital"
on public.patient_insurance_coverage
for insert
to authenticated
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = patient_insurance_coverage.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
  and exists (select 1 from public.patients p where p.id = patient_insurance_coverage.patient_id)
);

create policy "patient_insurance_update_practitioner_hospital"
on public.patient_insurance_coverage
for update
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = patient_insurance_coverage.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
  and exists (select 1 from public.patients p where p.id = patient_insurance_coverage.patient_id)
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = patient_insurance_coverage.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
  and exists (select 1 from public.patients p where p.id = patient_insurance_coverage.patient_id)
);

grant select, insert, update, delete on public.insurance_companies to authenticated, service_role;
grant select, insert, update, delete on public.patient_insurance_coverage to authenticated, service_role;
