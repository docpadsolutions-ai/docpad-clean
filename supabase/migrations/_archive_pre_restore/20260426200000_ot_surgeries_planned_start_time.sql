-- 12h display string from Schedule Surgery time wheel (e.g. "02:30 PM")
alter table public.ot_surgeries
  add column if not exists planned_start_time text;

comment on column public.ot_surgeries.planned_start_time is 'Planned OR start time as shown in UI (12h, e.g. 02:30 PM).';
