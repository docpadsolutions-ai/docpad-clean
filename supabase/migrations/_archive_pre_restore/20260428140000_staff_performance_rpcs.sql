-- Staff performance: attendance + activity storage, admin RPCs for directory overview and detail tab.

-- ---------------------------------------------------------------------------
-- Tables (hospital-scoped)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_attendance_days (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  work_date date not null,
  status text not null default 'present' check (status in ('present', 'late', 'absent')),
  arrived_at timestamptz,
  active_hours numeric(6, 2),
  created_at timestamptz not null default now(),
  unique (practitioner_id, work_date)
);

create index if not exists staff_attendance_days_hospital_date_idx
  on public.staff_attendance_days (hospital_id, work_date desc);

create table if not exists public.staff_activity_events (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  action text not null default 'activity',
  resource_type text not null default 'general',
  description text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists staff_activity_events_practitioner_time_idx
  on public.staff_activity_events (practitioner_id, occurred_at desc);

alter table public.staff_attendance_days enable row level security;
alter table public.staff_activity_events enable row level security;

drop policy if exists staff_attendance_days_admin_select on public.staff_attendance_days;
create policy staff_attendance_days_admin_select
  on public.staff_attendance_days for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = staff_attendance_days.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

drop policy if exists staff_activity_events_admin_select on public.staff_activity_events;
create policy staff_activity_events_admin_select
  on public.staff_activity_events for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = staff_activity_events.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

grant select on public.staff_attendance_days to authenticated, service_role;
grant select on public.staff_activity_events to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Caller hospital (practitioner row for session user)
-- ---------------------------------------------------------------------------
create or replace function public._staff_perf_caller_hospital()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pr.hospital_id
  from public.practitioners pr
  where pr.user_id = auth.uid() or pr.id = auth.uid()
  limit 1;
$$;

revoke all on function public._staff_perf_caller_hospital() from public;
grant execute on function public._staff_perf_caller_hospital() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_all_staff_performance_overview (no params; admin + same hospital)
-- ---------------------------------------------------------------------------
create or replace function public.get_all_staff_performance_overview()
returns table (
  practitioner_id uuid,
  attendance_pct numeric,
  actions_this_month bigint,
  opd_seen bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_month_start date := date_trunc('month', timezone('utc', now()))::date;
  v_month_end date := (date_trunc('month', timezone('utc', now())) + interval '1 month - 1 day')::date;
begin
  v_hospital := public._staff_perf_caller_hospital();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id as practitioner_id,
    coalesce(att.pct, 0::numeric) as attendance_pct,
    coalesce(act.cnt, 0::bigint) as actions_this_month,
    case
      when lower(coalesce(p.user_role, '') || ' ' || coalesce(p.role, '')) ~ '(^|[^[:alnum:]])doctor([^[:alnum:]]|$)'
        or lower(coalesce(p.user_role, '') || ' ' || coalesce(p.role, '')) ~* 'physician'
      then coalesce(opd.cnt, 0::bigint)
      else null::bigint
    end as opd_seen
  from public.practitioners p
  left join lateral (
    select
      case
        when count(*) = 0 then null::numeric
        else round(
          100.0 * count(*) filter (where d.status in ('present', 'late'))::numeric
            / nullif(count(*)::numeric, 0),
          1
        )
      end as pct
    from public.staff_attendance_days d
    where d.practitioner_id = p.id
      and d.hospital_id = v_hospital
      and d.work_date between v_month_start and v_month_end
  ) att on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.staff_activity_events e
    where e.practitioner_id = p.id
      and e.hospital_id = v_hospital
      and (e.occurred_at at time zone 'utc')::date between v_month_start and v_month_end
  ) act on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.opd_encounters e
    where e.hospital_id = v_hospital
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_month_start and v_month_end
      and (e.doctor_id = p.id or e.doctor_id = p.user_id)
  ) opd on true
  where p.hospital_id = v_hospital
  order by coalesce(nullif(trim(p.full_name), ''), p.email::text) nulls last;
end;
$fn$;

comment on function public.get_all_staff_performance_overview() is
  'Admin-only: per-practitioner attendance % (month), activity count (month), OPD seen for doctors.';

revoke all on function public.get_all_staff_performance_overview() from public;
grant execute on function public.get_all_staff_performance_overview() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_staff_performance_summary(practitioner, date range)
-- ---------------------------------------------------------------------------
create or replace function public.get_staff_performance_summary(
  p_practitioner_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  attendance_pct numeric,
  days_present integer,
  days_late integer,
  avg_late_minutes numeric,
  is_doctor boolean,
  is_nurse boolean,
  opd_encounters bigint,
  ipd_notes bigint,
  prescriptions bigint,
  investigations bigint,
  vitals_recorded bigint,
  medications_given bigint,
  nursing_notes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  r text;
  ur text;
begin
  if p_practitioner_id is null or p_date_from is null or p_date_to is null then
    raise exception 'practitioner_id and date range required';
  end if;
  if p_date_from > p_date_to then
    raise exception 'p_date_from must be <= p_date_to';
  end if;

  select p.hospital_id, coalesce(trim(p.role), ''), coalesce(trim(p.user_role), '')
  into v_hospital, r, ur
  from public.practitioners p
  where p.id = p_practitioner_id
  limit 1;

  if v_hospital is null then
    return;
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  return query
  select
    coalesce(att.pct, 0::numeric) as attendance_pct,
    coalesce(att.present_n, 0)::integer as days_present,
    coalesce(att.late_n, 0)::integer as days_late,
    coalesce(att.avg_late, 0::numeric) as avg_late_minutes,
    (lower(ur || ' ' || r) ~ '(^|[^[:alnum:]])doctor([^[:alnum:]]|$)' or lower(ur || ' ' || r) ~* 'physician') as is_doctor,
    (lower(ur || ' ' || r) ~ '(^|[^[:alnum:]])nurse([^[:alnum:]]|$)' or lower(ur || ' ' || r) ~* 'nursing') as is_nurse,
    coalesce(opd.cnt, 0::bigint) as opd_encounters,
    coalesce(ipd.cnt, 0::bigint) as ipd_notes,
    coalesce(rx.cnt, 0::bigint) as prescriptions,
    coalesce(inv.cnt, 0::bigint) as investigations,
    coalesce(vit.cnt, 0::bigint) as vitals_recorded,
    coalesce(med.cnt, 0::bigint) as medications_given,
    coalesce(nn.cnt, 0::bigint) as nursing_notes
  from public.practitioners p
  left join lateral (
    select
      case
        when count(*) = 0 then 0::numeric
        else round(100.0 * count(*) filter (where d.status in ('present', 'late'))::numeric / count(*)::numeric, 1)
      end as pct,
      count(*) filter (where d.status = 'present')::integer as present_n,
      count(*) filter (where d.status = 'late')::integer as late_n,
      avg(
        case
          when d.status = 'late' and d.arrived_at is not null
          then extract(epoch from (d.arrived_at - (d.work_date + time '09:00:00')::timestamp)) / 60.0
        end
      )::numeric as avg_late
    from public.staff_attendance_days d
    where d.practitioner_id = p_practitioner_id
      and d.hospital_id = v_hospital
      and d.work_date between p_date_from and p_date_to
  ) att on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.opd_encounters e
    where e.hospital_id = v_hospital
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_date_from and p_date_to
      and (e.doctor_id = p_practitioner_id or e.doctor_id = (select pr2.user_id from public.practitioners pr2 where pr2.id = p_practitioner_id))
  ) opd on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.staff_activity_events e
    where e.practitioner_id = p_practitioner_id
      and e.hospital_id = v_hospital
      and e.resource_type in ('ipd_note', 'ipd_progress_note')
      and (e.occurred_at at time zone 'utc')::date between p_date_from and p_date_to
  ) ipd on true
  left join lateral (
    select count(distinct prx.id)::bigint as cnt
    from public.prescriptions prx
    inner join public.opd_encounters oe on oe.id = prx.encounter_id
    where oe.hospital_id = v_hospital
      and (oe.doctor_id = p_practitioner_id or oe.doctor_id = (select pr2.user_id from public.practitioners pr2 where pr2.id = p_practitioner_id))
      and coalesce(
        (prx.created_at at time zone 'utc')::date,
        (oe.encounter_date)
      ) between p_date_from and p_date_to
  ) rx on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.investigations inv
    where inv.hospital_id = v_hospital
      and inv.doctor_id = p_practitioner_id
      and (inv.ordered_at at time zone 'utc')::date between p_date_from and p_date_to
  ) inv on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.staff_activity_events e
    where e.practitioner_id = p_practitioner_id
      and e.hospital_id = v_hospital
      and e.resource_type in ('vitals', 'vital')
      and (e.occurred_at at time zone 'utc')::date between p_date_from and p_date_to
  ) vit on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.staff_activity_events e
    where e.practitioner_id = p_practitioner_id
      and e.hospital_id = v_hospital
      and e.resource_type in ('medication', 'medication_given')
      and (e.occurred_at at time zone 'utc')::date between p_date_from and p_date_to
  ) med on true
  left join lateral (
    select count(*)::bigint as cnt
    from public.staff_activity_events e
    where e.practitioner_id = p_practitioner_id
      and e.hospital_id = v_hospital
      and e.resource_type in ('nursing_note', 'nurse_note')
      and (e.occurred_at at time zone 'utc')::date between p_date_from and p_date_to
  ) nn on true
  where p.id = p_practitioner_id
    and p.hospital_id = v_hospital
  limit 1;
end;
$fn$;

revoke all on function public.get_staff_performance_summary(uuid, date, date) from public;
grant execute on function public.get_staff_performance_summary(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_staff_attendance_calendar
-- ---------------------------------------------------------------------------
create or replace function public.get_staff_attendance_calendar(
  p_practitioner_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  work_date date,
  status text,
  arrived_at timestamptz,
  active_hours numeric,
  tooltip text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_practitioner_id is null or p_date_from is null or p_date_to is null then
    raise exception 'practitioner_id and date range required';
  end if;
  if p_date_from > p_date_to then
    raise exception 'p_date_from must be <= p_date_to';
  end if;

  select p.hospital_id into v_hospital
  from public.practitioners p
  where p.id = p_practitioner_id
  limit 1;

  if v_hospital is null then
    return;
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  return query
  select
    gs.d::date as work_date,
    coalesce(sad.status, 'absent')::text as status,
    sad.arrived_at,
    sad.active_hours,
    case
      when sad.arrived_at is not null and sad.active_hours is not null then
        'Arrived ' || to_char(sad.arrived_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
        || ' · Active ' || trim(to_char(sad.active_hours, 'FM9999990.0')) || ' hrs'
      when sad.arrived_at is not null then
        'Arrived ' || to_char(sad.arrived_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      when coalesce(sad.status, 'absent') = 'absent' then
        'Absent'
      else
        coalesce(initcap(sad.status), '—')
    end as tooltip
  from generate_series(p_date_from, p_date_to, interval '1 day') gs(d)
  left join public.staff_attendance_days sad
    on sad.work_date = (gs.d)::date
   and sad.practitioner_id = p_practitioner_id
   and sad.hospital_id = v_hospital
  order by gs.d;
end;
$fn$;

revoke all on function public.get_staff_attendance_calendar(uuid, date, date) from public;
grant execute on function public.get_staff_attendance_calendar(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_staff_activity_log (paginated; total on each row via window)
-- ---------------------------------------------------------------------------
create or replace function public.get_staff_activity_log(
  p_practitioner_id uuid,
  p_date_from date,
  p_date_to date,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  occurred_at timestamptz,
  action text,
  resource_type text,
  description text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  lim integer := greatest(coalesce(p_limit, 30), 1);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_practitioner_id is null or p_date_from is null or p_date_to is null then
    raise exception 'practitioner_id and date range required';
  end if;
  if p_date_from > p_date_to then
    raise exception 'p_date_from must be <= p_date_to';
  end if;

  select p.hospital_id into v_hospital
  from public.practitioners p
  where p.id = p_practitioner_id
  limit 1;

  if v_hospital is null then
    return;
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  return query
  select
    e.id,
    e.occurred_at,
    e.action,
    e.resource_type,
    e.description,
    count(*) over ()::bigint as total_count
  from public.staff_activity_events e
  where e.practitioner_id = p_practitioner_id
    and e.hospital_id = v_hospital
    and (e.occurred_at at time zone 'utc')::date between p_date_from and p_date_to
  order by e.occurred_at desc
  limit lim
  offset off;
end;
$fn$;

revoke all on function public.get_staff_activity_log(uuid, date, date, integer, integer) from public;
grant execute on function public.get_staff_activity_log(uuid, date, date, integer, integer) to authenticated, service_role;
