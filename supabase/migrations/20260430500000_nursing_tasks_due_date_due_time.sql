-- Split task due into due_date (date) + due_time (time); keep RPCs aligned.

alter table public.nursing_tasks
  add column if not exists due_date date;

alter table public.nursing_tasks
  add column if not exists due_time time;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nursing_tasks'
      and column_name = 'due_at'
  ) then
    update public.nursing_tasks t
    set
      due_date = coalesce(
        t.due_date,
        ((t.due_at at time zone 'Asia/Kolkata'))::date
      ),
      due_time = coalesce(
        t.due_time,
        ((t.due_at at time zone 'Asia/Kolkata'))::time
      )
    where t.due_at is not null
      and (t.due_date is null or t.due_time is null);
  end if;
end $$;

alter table public.nursing_tasks
  drop column if exists due_at;

-- Per-admission checklist JSON (3-arg) — expose due_date / due_time; sort by combined local due.
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
      order by q.category_sort, q.pending_sort, q.due_sort nulls last, q.task_name
    ),
    '[]'::jsonb
  )
  from (
    select
      t.task_name,
      case
        when t.due_time is not null then (
          coalesce(t.due_date, t.scheduled_date)::timestamp
          + t.due_time
        )
        else null
      end as due_sort,
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
        'due_date', t.due_date,
        'due_time', t.due_time,
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

-- Ward queue (2-arg): timestamptz for UI from due_date + due_time (IST wall clock).
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
    case
      when t.due_time is not null then
        ((coalesce(t.due_date, t.scheduled_date)::timestamp + t.due_time) at time zone 'Asia/Kolkata')
      else null::timestamptz
    end as due_time,
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
    case
      when t.due_time is not null then (
        coalesce(t.due_date, t.scheduled_date)::timestamp
        + t.due_time
      )
      else null
    end nulls last,
    t.task_name;
$$;

grant execute on function public.get_nursing_shift_tasks(text, date) to authenticated, service_role;

grant execute on function public.get_nursing_shift_tasks(uuid, text, date) to authenticated, service_role;
