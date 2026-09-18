-- Denormalized `shift` (mirrors scheduled_shift) for clients that read `shift` on insert.

alter table public.nursing_tasks
  add column if not exists shift text;

update public.nursing_tasks
set shift = lower(trim(scheduled_shift))
where shift is null
  and scheduled_shift is not null;
