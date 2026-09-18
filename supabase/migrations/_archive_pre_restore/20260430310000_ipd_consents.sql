-- Free-form IPD consent requests (distinct from catalog-backed `ipd_admission_consents`).

create table if not exists public.ipd_consents (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  consent_type text not null default 'custom',
  is_custom boolean not null default false,
  custom_title text,
  custom_description text,
  status text not null default 'pending',
  requested_by uuid references public.practitioners (id) on delete set null,
  requested_at timestamptz not null default now(),
  obtained_at timestamptz,
  witness_name text,
  signed_document_path text,
  is_emergency_override boolean not null default false,
  override_reason text,
  notes text,
  fhir_json jsonb not null default '{}'::jsonb,
  constraint ipd_consents_status_chk check (
    lower(status) in ('pending', 'signed', 'waived', 'obtained', 'completed')
  )
);

create index if not exists ipd_consents_admission_idx on public.ipd_consents (admission_id);
create index if not exists ipd_consents_hospital_idx on public.ipd_consents (hospital_id);
create index if not exists ipd_consents_patient_idx on public.ipd_consents (patient_id);

comment on table public.ipd_consents is
  'IPD consent instances including hospital-defined custom consents (is_custom=true).';

alter table public.ipd_consents enable row level security;

drop policy if exists "ipd_consents_select_staff" on public.ipd_consents;
create policy "ipd_consents_select_staff"
on public.ipd_consents
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_consents.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

drop policy if exists "ipd_consents_insert_staff" on public.ipd_consents;
create policy "ipd_consents_insert_staff"
on public.ipd_consents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_consents.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

drop policy if exists "ipd_consents_update_staff" on public.ipd_consents;
create policy "ipd_consents_update_staff"
on public.ipd_consents
for update
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_consents.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_consents.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update on public.ipd_consents to authenticated, service_role;
