-- IPD nursing shift tasks: checklist rows + RPCs + realtime.

create table if not exists public.nursing_tasks (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  task_name text not null,
  task_category text not null,
  priority text not null default 'ROUTINE',
  instructions text,
  source_order_text text,
  scheduled_shift text not null,
  scheduled_date date not null,
  due_at timestamptz,
  status text not null default 'pending',
  completed_at timestamptz,
  completed_by uuid references public.practitioners (id) on delete set null,
  completed_notes text,
  outcome_json jsonb not null default '{}'::jsonb,
  skip_reason text,
  skipped_at timestamptz,
  skipped_by uuid references public.practitioners (id) on delete set null,
  created_by uuid references public.practitioners (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nursing_tasks_category_chk check (
    task_category in (
      'vascular_check',
      'neuro_check',
      'wound_care',
      'drain_care',
      'traction_check',
      'cast_check',
      'vitals',
      'medication',
      'iv_care',
      'mobilisation',
      'positioning',
      'other'
    )
  ),
  constraint nursing_tasks_priority_chk check (priority in ('STAT', 'URGENT', 'ROUTINE')),
  constraint nursing_tasks_status_chk check (status in ('pending', 'completed', 'skipped')),
  constraint nursing_tasks_shift_chk check (
    lower(trim(scheduled_shift)) in ('morning', 'afternoon', 'night')
  )
);

create index if not exists nursing_tasks_admission_date_shift_idx
  on public.nursing_tasks (admission_id, scheduled_date, scheduled_shift);

create index if not exists nursing_tasks_hospital_idx on public.nursing_tasks (hospital_id);

comment on table public.nursing_tasks is
  'Shift-scoped nursing tasks for an IPD admission; UI checklist + completion outcomes.';

-- ---------------------------------------------------------------------------
-- Helper: current practitioner id (session)
-- ---------------------------------------------------------------------------
create or replace function public._nursing_tasks_current_practitioner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select id from public.practitioners where user_id = (select auth.uid()) limit 1),
    (select id from public.practitioners where id = (select auth.uid()) limit 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: list tasks for admission + shift + date (sorted: category, pending first, due)
-- ---------------------------------------------------------------------------
create or replace function public.get_nursing_shift_tasks(
  p_admission_id uuid,
  p_shift text,
  p_date date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      q.obj
      order by q.category_sort, q.pending_sort, q.due_at nulls last, q.task_name
    ),
    '[]'::jsonb
  )
  from (
    select
      t.task_name,
      t.due_at,
      case lower(trim(t.task_category))
        when 'vascular_check' then 0
        when 'neuro_check' then 1
        when 'wound_care' then 2
        when 'drain_care' then 3
        when 'traction_check' then 4
        when 'cast_check' then 5
        when 'vitals' then 6
        when 'medication' then 7
        when 'iv_care' then 8
        when 'mobilisation' then 9
        when 'positioning' then 10
        else 11
      end as category_sort,
      case when t.status = 'pending' then 0 else 1 end as pending_sort,
      jsonb_build_object(
        'id', t.id,
        'admission_id', t.admission_id,
        'hospital_id', t.hospital_id,
        'task_name', t.task_name,
        'task_category', t.task_category,
        'priority', t.priority,
        'instructions', t.instructions,
        'source_order_text', t.source_order_text,
        'scheduled_shift', t.scheduled_shift,
        'scheduled_date', t.scheduled_date,
        'due_at', t.due_at,
        'status', t.status,
        'completed_at', t.completed_at,
        'completed_by', t.completed_by,
        'completed_notes', t.completed_notes,
        'outcome_json', t.outcome_json,
        'skip_reason', t.skip_reason,
        'skipped_at', t.skipped_at,
        'skipped_by', t.skipped_by,
        'created_by', t.created_by,
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'completed_by_name', cp.full_name,
        'skipped_by_name', sp.full_name
      ) as obj
    from public.nursing_tasks t
    left join public.practitioners cp on cp.id = t.completed_by
    left join public.practitioners sp on sp.id = t.skipped_by
    where t.admission_id = p_admission_id
      and t.scheduled_date = p_date
      and lower(trim(t.scheduled_shift)) = lower(trim(p_shift))
  ) q;
$$;

-- ---------------------------------------------------------------------------
-- RPC: complete task
-- ---------------------------------------------------------------------------
create or replace function public.complete_nursing_task(
  p_task_id uuid,
  p_notes text,
  p_outcome_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practitioner uuid := public._nursing_tasks_current_practitioner_id();
  v_row public.nursing_tasks%rowtype;
begin
  if v_practitioner is null then
    raise exception 'Not authenticated as practitioner';
  end if;

  update public.nursing_tasks t
  set
    status = 'completed',
    completed_at = now(),
    completed_by = v_practitioner,
    completed_notes = p_notes,
    outcome_json = coalesce(p_outcome_json, '{}'::jsonb),
    updated_at = now()
  where t.id = p_task_id
    and t.status = 'pending'
    and exists (
      select 1
      from public.ipd_admissions a
      where a.id = t.admission_id
        and exists (
          select 1
          from public.practitioners pr
          where pr.id = v_practitioner
            and pr.hospital_id = a.hospital_id
        )
    )
  returning * into v_row;

  if not found then
    raise exception 'Task not found or cannot be completed';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: skip task
-- ---------------------------------------------------------------------------
create or replace function public.skip_nursing_task(
  p_task_id uuid,
  p_skip_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practitioner uuid := public._nursing_tasks_current_practitioner_id();
  v_row public.nursing_tasks%rowtype;
  v_reason text := nullif(trim(coalesce(p_skip_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'skip_reason is required';
  end if;

  if v_practitioner is null then
    raise exception 'Not authenticated as practitioner';
  end if;

  update public.nursing_tasks t
  set
    status = 'skipped',
    skipped_at = now(),
    skipped_by = v_practitioner,
    skip_reason = v_reason,
    updated_at = now()
  where t.id = p_task_id
    and t.status = 'pending'
    and exists (
      select 1
      from public.ipd_admissions a
      where a.id = t.admission_id
        and exists (
          select 1
          from public.practitioners pr
          where pr.id = v_practitioner
            and pr.hospital_id = a.hospital_id
        )
    )
  returning * into v_row;

  if not found then
    raise exception 'Task not found or cannot be skipped';
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.get_nursing_shift_tasks(uuid, text, date) to authenticated, service_role;
grant execute on function public.complete_nursing_task(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.skip_nursing_task(uuid, text) to authenticated, service_role;

alter table public.nursing_tasks enable row level security;

drop policy if exists "nursing_tasks_select_staff" on public.nursing_tasks;
create policy "nursing_tasks_select_staff"
on public.nursing_tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.ipd_admissions a
    inner join public.practitioners pr
      on pr.hospital_id = a.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    where a.id = nursing_tasks.admission_id
  )
);

drop policy if exists "nursing_tasks_insert_staff" on public.nursing_tasks;
create policy "nursing_tasks_insert_staff"
on public.nursing_tasks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.ipd_admissions a
    inner join public.practitioners pr
      on pr.hospital_id = a.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    where a.id = nursing_tasks.admission_id
      and a.hospital_id = nursing_tasks.hospital_id
  )
);

drop policy if exists "nursing_tasks_update_staff" on public.nursing_tasks;
create policy "nursing_tasks_update_staff"
on public.nursing_tasks
for update
to authenticated
using (
  exists (
    select 1
    from public.ipd_admissions a
    inner join public.practitioners pr
      on pr.hospital_id = a.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    where a.id = nursing_tasks.admission_id
  )
)
with check (
  exists (
    select 1
    from public.ipd_admissions a
    inner join public.practitioners pr
      on pr.hospital_id = a.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    where a.id = nursing_tasks.admission_id
  )
);

grant select, insert, update on public.nursing_tasks to authenticated, service_role;

alter table public.nursing_tasks replica identity full;

do $blk$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'nursing_tasks' and schemaname = 'public') then
    null;
  else
    execute 'alter publication supabase_realtime add table public.nursing_tasks';
  end if;
end;
$blk$;
