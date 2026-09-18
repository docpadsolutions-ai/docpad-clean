-- Optional columns for manual task creation and richer scheduling.

alter table public.nursing_tasks
  add column if not exists patient_id uuid references public.patients (id) on delete set null;

alter table public.nursing_tasks
  add column if not exists frequency text not null default 'once';

alter table public.nursing_tasks
  add column if not exists is_recurring boolean not null default false;
