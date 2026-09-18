-- Store wound photo storage paths on the assessment row (private bucket keys).

alter table public.ipd_wound_assessments
  add column if not exists photo_storage_paths text[] not null default '{}';

comment on column public.ipd_wound_assessments.photo_storage_paths is
  'Keys in wound-photos bucket (hospital_id/admission_id/assessment_id/...).';
