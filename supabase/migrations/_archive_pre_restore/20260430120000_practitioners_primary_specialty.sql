-- Optional primary specialty distinct from legacy `specialty` (e.g. for UI gates).

alter table public.practitioners
  add column if not exists primary_specialty text;

comment on column public.practitioners.primary_specialty is
  'Primary clinical specialty label when distinct from `specialty`; used for product rules (e.g. surgical workflows).';
