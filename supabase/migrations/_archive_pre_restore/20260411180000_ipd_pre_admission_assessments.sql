-- Pre-admission clinical documentation (OPD → IPD) saved before consent + admit_patient.
-- RLS/policies should be added per environment.

create table if not exists public.ipd_pre_admission_assessments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  opd_encounter_id uuid not null,
  patient_id uuid not null,
  practitioner_id uuid,
  specialty text,
  chief_complaint text,
  chief_complaint_details jsonb not null default '{}',
  hpi_one_liner text,
  hpi_narrative text,
  symptoms_json jsonb not null default '[]',
  symptoms_opqrst jsonb not null default '{}',
  ros_json jsonb not null default '{}',
  relevant_context jsonb not null default '{}',
  vital_signs jsonb not null default '{}',
  general_appearance text,
  systemic_examination text,
  surgical_plan_notes text,
  primary_diagnosis_icd10 text,
  primary_diagnosis_display text,
  assessment_plan_notes text,
  treatments_json jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ipd_pre_admission_assessments_encounter_idx
  on public.ipd_pre_admission_assessments (opd_encounter_id);

create index if not exists ipd_pre_admission_assessments_patient_idx
  on public.ipd_pre_admission_assessments (patient_id);
