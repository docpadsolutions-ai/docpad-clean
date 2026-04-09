-- Tracked ABDM/NDHM consent grants with explicit expiry for compliance + cron job.

create table if not exists public.abdm_patient_consents (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  consent_request_id text,
  hi_types text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'denied')),
  granted_at timestamptz,
  expires_at timestamptz not null,
  source_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists abdm_patient_consents_expiry_status_idx
  on public.abdm_patient_consents (expires_at, status)
  where status = 'active';

create index if not exists abdm_patient_consents_patient_idx
  on public.abdm_patient_consents (patient_id);

comment on table public.abdm_patient_consents is
  'ABDM consent grants with HI types and expiry; expired by abdm-consent-expiry Edge Function (cron).';

alter table public.abdm_patient_consents enable row level security;

create policy "abdm_patient_consents_select_authenticated"
on public.abdm_patient_consents
for select
to authenticated
using (true);
