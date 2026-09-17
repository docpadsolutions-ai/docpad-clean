-- IPD nursing vitals: timestamped multi-readings per admission (NABH audit trail; append-only).

create table if not exists public.ipd_nursing_vitals (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  recorded_by uuid references public.practitioners (id) on delete set null,
  recorded_at timestamptz not null default timezone('utc', now()),
  blood_pressure text,
  pulse numeric,
  temperature numeric,
  spo2 numeric,
  respiratory_rate numeric,
  weight numeric,
  urine_output numeric,
  gcs_score integer,
  pain_score integer,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ipd_nursing_vitals_admission_recorded_idx
  on public.ipd_nursing_vitals (admission_id, recorded_at desc);

create index if not exists ipd_nursing_vitals_hospital_idx
  on public.ipd_nursing_vitals (hospital_id);

comment on table public.ipd_nursing_vitals is
  'IPD nursing vital signs; immutable clinical record (no updates/deletes via RLS).';

alter table public.ipd_nursing_vitals enable row level security;

drop policy if exists ipd_nursing_vitals_select_practitioner_hospital on public.ipd_nursing_vitals;
create policy ipd_nursing_vitals_select_practitioner_hospital
  on public.ipd_nursing_vitals for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_nursing_vitals.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists ipd_nursing_vitals_insert_practitioner_hospital on public.ipd_nursing_vitals;
create policy ipd_nursing_vitals_insert_practitioner_hospital
  on public.ipd_nursing_vitals for insert to authenticated
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_nursing_vitals.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert on public.ipd_nursing_vitals to authenticated, service_role;
