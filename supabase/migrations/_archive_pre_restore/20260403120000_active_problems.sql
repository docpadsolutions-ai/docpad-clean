-- Active problem list synced from encounter diagnoses (Summary Sync).
-- Unique (patient_id, condition_name) enables upsert deduplication across visits.

create table if not exists public.active_problems (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  org_id uuid not null,
  condition_name text not null,
  snomed_code text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint active_problems_patient_condition_unique unique (patient_id, condition_name)
);

create index if not exists active_problems_patient_id_idx on public.active_problems (patient_id);
create index if not exists active_problems_org_id_idx on public.active_problems (org_id);

alter table public.active_problems enable row level security;

-- Adjust policies to match your org; example: members of same org can read/write
-- create policy "..." on public.active_problems for all using (...);
