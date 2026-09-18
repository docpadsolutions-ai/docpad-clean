-- Optional clinical onset for problem list display (Summary "Since MMM YYYY").
alter table public.active_problems
  add column if not exists onset_date date;

comment on column public.active_problems.onset_date is
  'Approximate problem onset; UI falls back to created_at when null.';
