-- Narrative clinical highlights on the Patient Summary dashboard
create table if not exists public.patient_summaries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  org_id uuid,
  highlights_text text,
  updated_at timestamptz not null default now(),
  constraint patient_summaries_patient_unique unique (patient_id)
);

create index if not exists patient_summaries_org_id_idx on public.patient_summaries (org_id);

-- Optional: link Rx lines to an indication for summary grouping
alter table public.prescriptions add column if not exists clinical_indication text;
