-- Ward-level nursing task queue RPC, category/priority extensions, source_kind, complete_nursing_task(text outcome) overload.

-- ---------------------------------------------------------------------------
-- source_kind + relaxed categories / priority (HIGH + VTE bundle categories)
-- ---------------------------------------------------------------------------
alter table public.nursing_tasks
  add column if not exists source_kind text;

update public.nursing_tasks
set source_kind = 'doctor_order'
where source_kind is null
  and source_order_text is not null
  and length(trim(source_order_text)) > 0;

update public.nursing_tasks
set source_kind = 'manual'
where source_kind is null;

alter table public.nursing_tasks
  alter column source_kind set default 'manual';

alter table public.nursing_tasks
  drop constraint if exists nursing_tasks_category_chk;

alter table public.nursing_tasks
  add constraint nursing_tasks_category_chk check (
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
      'vte',
      'fall_risk',
      'pressure_sore',
      'other'
    )
  );

alter table public.nursing_tasks
  drop constraint if exists nursing_tasks_priority_chk;

alter table public.nursing_tasks
  add constraint nursing_tasks_priority_chk check (
    priority in ('STAT', 'URGENT', 'HIGH', 'ROUTINE')
  );

alter table public.nursing_tasks
  drop constraint if exists nursing_tasks_source_kind_chk;

alter table public.nursing_tasks
  add constraint nursing_tasks_source_kind_chk check (
    source_kind is null or source_kind in ('doctor_order', 'care_plan', 'manual')
  );

-- ---------------------------------------------------------------------------
-- Hospital-wide shift task list (2-arg overload; distinct from per-admission 3-arg RPC)
-- Optional p_shift / p_date default to current shift window / today (UTC date).
-- ---------------------------------------------------------------------------
create or replace function public.get_nursing_shift_tasks(
  p_shift text default null,
  p_date date default null
)
returns table (
  task_id uuid,
  patient_name text,
  bed_number text,
  ward_name text,
  task_name text,
  task_category text,
  priority text,
  shift text,
  due_time timestamptz,
  status text,
  instructions text,
  source text,
  admission_id uuid,
  hospital_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select pr.hospital_id as hid
    from public.practitioners pr
    where pr.user_id = (select auth.uid())
       or pr.id = (select auth.uid())
    limit 1
  ),
  day as (
    select coalesce(p_date, ((timezone('utc', now())))::date) as d
  ),
  shift_f as (
    select case
      when p_shift is not null and length(trim(p_shift)) > 0 then lower(trim(p_shift))
      else (
        select case
          when extract(hour from timezone('utc', now())) >= 7
            and extract(hour from timezone('utc', now())) < 15 then 'morning'
          when extract(hour from timezone('utc', now())) >= 15
            and extract(hour from timezone('utc', now())) < 23 then 'afternoon'
          else 'night'
        end
      )
    end as sk
  )
  select
    t.id as task_id,
    coalesce(pat.full_name, 'Patient') as patient_name,
    coalesce(b.bed_number::text, '—') as bed_number,
    coalesce(w.name, 'Unassigned') as ward_name,
    t.task_name,
    t.task_category,
    t.priority,
    initcap(trim(t.scheduled_shift)) as shift,
    t.due_at as due_time,
    t.status,
    t.instructions,
    case coalesce(t.source_kind, 'manual')
      when 'doctor_order' then 'Doctor Order'
      when 'care_plan' then 'Care Plan'
      else 'Manual'
    end as source,
    t.admission_id,
    t.hospital_id
  from public.nursing_tasks t
  inner join public.ipd_admissions a on a.id = t.admission_id
  inner join public.patients pat on pat.id = a.patient_id
  inner join me on me.hid = t.hospital_id
  cross join day
  cross join shift_f
  left join public.ipd_beds b on b.id = a.bed_id
  left join public.ipd_wards w on w.id = a.ward_id
  where t.scheduled_date = day.d
    and lower(trim(t.scheduled_shift)) = shift_f.sk
    and t.status = 'pending'
    and a.discharged_at is null
    and (a.status is null or a.status not in ('discharged', 'cancelled'))
  order by
    pat.full_name,
    b.bed_number nulls last,
    t.due_at nulls last,
    t.task_name;
$$;

grant execute on function public.get_nursing_shift_tasks(text, date) to authenticated, service_role;
