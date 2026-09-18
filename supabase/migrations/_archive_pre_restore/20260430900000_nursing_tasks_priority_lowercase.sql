-- Store priority in lowercase to match UI option values; constraint stays strict (no reliance on lower() at insert).

update public.nursing_tasks
set priority = lower(trim(priority))
where priority is not null;

alter table public.nursing_tasks
  drop constraint if exists nursing_tasks_priority_chk;

alter table public.nursing_tasks
  add constraint nursing_tasks_priority_chk check (
    priority in ('stat', 'urgent', 'high', 'routine')
  );

alter table public.nursing_tasks
  alter column priority set default 'routine';
