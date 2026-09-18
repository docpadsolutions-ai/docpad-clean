-- Admin / NABH hospital analytics: operational & clinical RPCs, compliance storage + calculator.
-- Uses existing _billing_assert_hospital_access (practitioner hospital match).

-- ---------------------------------------------------------------------------
-- Optional columns on remote-first tables (guarded)
-- ---------------------------------------------------------------------------
do $guard$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'appointments'
  ) then
    alter table public.appointments add column if not exists check_in_time timestamptz;
    alter table public.appointments add column if not exists department_id uuid references public.departments (id) on delete set null;
  end if;
end
$guard$;

alter table public.investigations add column if not exists ordered_at timestamptz;
alter table public.investigations add column if not exists resulted_at timestamptz;

create index if not exists investigations_hospital_ordered_at_idx
  on public.investigations (hospital_id, ordered_at desc)
  where ordered_at is not null;

-- ---------------------------------------------------------------------------
-- Procedure consent sign-offs (populate from workflows; drives consent %)
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_procedure_consents (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  opd_encounter_id uuid references public.opd_encounters (id) on delete cascade,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists clinical_procedure_consents_hospital_idx
  on public.clinical_procedure_consents (hospital_id);

alter table public.clinical_procedure_consents enable row level security;

drop policy if exists "clinical_procedure_consents_hospital_peers" on public.clinical_procedure_consents;

create policy "clinical_procedure_consents_hospital_peers"
on public.clinical_procedure_consents
for all
to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = clinical_procedure_consents.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = clinical_procedure_consents.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update, delete on public.clinical_procedure_consents to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- NABH compliance snapshot (filled by calculate_compliance_scores)
-- ---------------------------------------------------------------------------
do $enum$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'nabh_compliance_check_type'
  ) then
    create type public.nabh_compliance_check_type as enum (
      'documentation_complete',
      'consent_present',
      'note_timeliness'
    );
  end if;
end
$enum$;

create table if not exists public.nabh_compliance_checks (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  check_type public.nabh_compliance_check_type not null,
  department_id uuid references public.departments (id) on delete cascade,
  score_percentage numeric(6, 2),
  detail jsonb,
  last_calculated_at timestamptz not null default now()
);

create unique index if not exists nabh_compliance_checks_hosp_type_dept_idx
  on public.nabh_compliance_checks (
    hospital_id,
    check_type,
    (coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

create index if not exists nabh_compliance_checks_hospital_idx
  on public.nabh_compliance_checks (hospital_id);

comment on table public.nabh_compliance_checks is
  'NABH-oriented compliance scores per hospital/department; detail jsonb holds e.g. missing-field counts for documentation.';

alter table public.nabh_compliance_checks enable row level security;

drop policy if exists "nabh_compliance_checks_hospital_select" on public.nabh_compliance_checks;

create policy "nabh_compliance_checks_hospital_select"
on public.nabh_compliance_checks
for select
to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = nabh_compliance_checks.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select on public.nabh_compliance_checks to authenticated, service_role;
grant insert, update, delete on public.nabh_compliance_checks to service_role;

-- ---------------------------------------------------------------------------
-- 1) get_avg_consultation_time
-- ---------------------------------------------------------------------------
create or replace function public.get_avg_consultation_time(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  avg_consultation_minutes numeric,
  completed_encounter_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select
    round(
      avg(extract(epoch from (e.updated_at - e.created_at)) / 60.0)::numeric,
      2
    ) as avg_consultation_minutes,
    count(*)::bigint as completed_encounter_count
  from public.opd_encounters e
  where e.hospital_id = p_hospital_id
    and e.status = 'completed'
    and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
    and e.updated_at > e.created_at
    and (e.updated_at - e.created_at) <= interval '12 hours';
end;
$fn$;

comment on function public.get_avg_consultation_time(uuid, date, date) is
  'NABH §3.2: mean consultation length (created_at → updated_at) for completed OPD encounters.';

revoke all on function public.get_avg_consultation_time(uuid, date, date) from public;
grant execute on function public.get_avg_consultation_time(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) get_avg_wait_time (registration / check-in → encounter start)
-- ---------------------------------------------------------------------------
create or replace function public.get_avg_wait_time(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  avg_wait_minutes numeric,
  sample_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'appointments'
  ) then
    return query select null::numeric, 0::bigint;
    return;
  end if;

  return query
  select
    round(
      avg(
        extract(epoch from (e.created_at - coalesce(a.check_in_time, a.created_at))) / 60.0
      )::numeric,
      2
    ) as avg_wait_minutes,
    count(*)::bigint as sample_count
  from public.opd_encounters e
  inner join public.appointments a on a.id = e.appointment_id
  where e.hospital_id = p_hospital_id
    and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
    and e.created_at > coalesce(a.check_in_time, a.created_at)
    and extract(epoch from (e.created_at - coalesce(a.check_in_time, a.created_at))) / 60.0 <= 24 * 60;
end;
$fn$;

comment on function public.get_avg_wait_time(uuid, date, date) is
  'Mean wait from appointments.check_in_time (fallback created_at) to opd_encounters.created_at.';

revoke all on function public.get_avg_wait_time(uuid, date, date) from public;
grant execute on function public.get_avg_wait_time(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) get_noshow_rate
-- ---------------------------------------------------------------------------
create or replace function public.get_noshow_rate(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  no_show_count bigint,
  total_booked bigint,
  no_show_rate_pct numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'appointments'
  ) then
    return query select 0::bigint, 0::bigint, 0::numeric;
    return;
  end if;

  return query
  with ap as (
    select a.status
    from public.appointments a
    where a.hospital_id = p_hospital_id
      and (a.created_at at time zone 'utc')::date between p_start_date and p_end_date
      and coalesce(lower(a.status), '') <> 'cancelled'
  )
  select
    count(*) filter (where lower(coalesce(ap.status, '')) = 'no_show')::bigint as no_show_count,
    count(*)::bigint as total_booked,
    case
      when count(*) = 0 then 0::numeric
      else round(
        100.0 * count(*) filter (where lower(coalesce(ap.status, '')) = 'no_show') / count(*)::numeric,
        2
      )
    end as no_show_rate_pct
  from ap;
end;
$fn$;

revoke all on function public.get_noshow_rate(uuid, date, date) from public;
grant execute on function public.get_noshow_rate(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) get_opd_utilization (booked appointments vs department slot capacity)
-- ---------------------------------------------------------------------------
create or replace function public.get_opd_utilization(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  department_id uuid,
  department_name text,
  booked_slots bigint,
  total_available_slots bigint,
  utilization_pct numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  with days as (
    select d::date as day
    from generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') g(d)
  ),
  depts as (
    select
      dep.id as id,
      dep.name as name,
      dep.opd_hours_start as h0,
      dep.opd_hours_end as h1,
      dep.slot_duration_minutes as slot_min
    from public.departments dep
    where dep.hospital_id = p_hospital_id
      and dep.is_active
      and dep.type = 'clinical'
      and dep.opd_hours_start is not null
      and dep.opd_hours_end is not null
      and dep.opd_hours_end > dep.opd_hours_start
  ),
  slot_capacity as (
    select
      depts.id as department_id,
      days.day,
      greatest(
        1,
        floor(
          extract(epoch from (depts.h1 - depts.h0)) / 60.0
            / nullif(depts.slot_min, 0)::numeric
        )
      )::bigint as slots
    from depts
    cross join days
  ),
  booked as (
    select
      x.department_id,
      x.day,
      count(*)::bigint as n
    from (
      select
        coalesce(a.department_id, e.department_id) as department_id,
        (a.created_at at time zone 'utc')::date as day
      from public.appointments a
      left join lateral (
        select e2.department_id
        from public.opd_encounters e2
        where e2.appointment_id = a.id
          and e2.hospital_id = a.hospital_id
        order by e2.created_at desc
        limit 1
      ) e on true
      where a.hospital_id = p_hospital_id
        and exists (select 1 from depts d where d.id = coalesce(a.department_id, e.department_id))
        and (a.created_at at time zone 'utc')::date between p_start_date and p_end_date
        and coalesce(lower(a.status), '') <> 'cancelled'
    ) x
    where x.department_id is not null
    group by x.department_id, x.day
  )
  select
    sc.department_id,
    coalesce(dep.name, 'Department')::text as department_name,
    coalesce(sum(b.n), 0)::bigint as booked_slots,
    sum(sc.slots)::bigint as total_available_slots,
    case
      when sum(sc.slots) = 0 then null::numeric
      else round(100.0 * coalesce(sum(b.n), 0)::numeric / sum(sc.slots)::numeric, 2)
    end as utilization_pct
  from slot_capacity sc
  inner join public.departments dep on dep.id = sc.department_id
  left join booked b
    on b.department_id = sc.department_id
   and b.day = sc.day
  group by sc.department_id, dep.name
  order by dep.name;
end;
$fn$;

comment on function public.get_opd_utilization(uuid, date, date) is
  'OPD slots: sum of per-day capacity from department OPD window ÷ slot length vs appointment counts by department.';

revoke all on function public.get_opd_utilization(uuid, date, date) from public;
grant execute on function public.get_opd_utilization(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) get_operational_daily_metrics (line charts)
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_daily_metrics(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  metric_date date,
  avg_consultation_minutes numeric,
  consultation_count bigint,
  avg_wait_minutes numeric,
  wait_sample_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  with days as (
    select d::date as day
    from generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') g(d)
  ),
  consult as (
    select
      coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) as day,
      avg(extract(epoch from (e.updated_at - e.created_at)) / 60.0)::numeric as avg_min,
      count(*)::bigint as cnt
    from public.opd_encounters e
    where e.hospital_id = p_hospital_id
      and e.status = 'completed'
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
      and e.updated_at > e.created_at
      and (e.updated_at - e.created_at) <= interval '12 hours'
    group by 1
  ),
  waits as (
    select
      coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) as day,
      avg(
        extract(epoch from (e.created_at - coalesce(a.check_in_time, a.created_at))) / 60.0
      )::numeric as avg_min,
      count(*)::bigint as cnt
    from public.opd_encounters e
    inner join public.appointments a on a.id = e.appointment_id
    where e.hospital_id = p_hospital_id
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
      and e.created_at > coalesce(a.check_in_time, a.created_at)
      and extract(epoch from (e.created_at - coalesce(a.check_in_time, a.created_at))) / 60.0 <= 24 * 60
    group by 1
  )
  select
    days.day as metric_date,
    round(c.avg_min::numeric, 2) as avg_consultation_minutes,
    coalesce(c.cnt, 0::bigint) as consultation_count,
    round(w.avg_min::numeric, 2) as avg_wait_minutes,
    coalesce(w.cnt, 0::bigint) as wait_sample_count
  from days
  left join consult c on c.day = days.day
  left join waits w on w.day = days.day
  order by days.day;
end;
$fn$;

revoke all on function public.get_operational_daily_metrics(uuid, date, date) from public;
grant execute on function public.get_operational_daily_metrics(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) get_top_diagnoses (SNOMED / FHIR DiagnosticReport-style codes)
-- ---------------------------------------------------------------------------
create or replace function public.get_top_diagnoses(
  p_hospital_id uuid,
  p_limit integer,
  p_start_date date,
  p_end_date date,
  p_specialty text default null
)
returns table (
  snomed_code text,
  display_name text,
  count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lim int := coalesce(nullif(p_limit, 0), 10);
begin
  if v_lim < 1 then
    v_lim := 10;
  end if;
  if v_lim > 100 then
    v_lim := 100;
  end if;
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select
    coalesce(
      nullif(trim(e.diagnosis_snomed), ''),
      nullif(trim(e.diagnosis_sctid), ''),
      nullif(trim(e.diagnosis_fhir->>'code'), ''),
      'UNKNOWN'
    )::text as snomed_code,
    coalesce(
      nullif(trim(e.diagnosis_term), ''),
      nullif(trim(e.diagnosis_fhir->>'display'), ''),
      'Unknown'
    )::text as display_name,
    count(*)::bigint as count
  from public.opd_encounters e
  left join public.practitioners pr
    on (pr.id = e.doctor_id or pr.user_id = e.doctor_id)
    and pr.hospital_id = p_hospital_id
  where e.hospital_id = p_hospital_id
    and e.status = 'completed'
    and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
    and (
      nullif(trim(e.diagnosis_snomed), '') is not null
      or nullif(trim(e.diagnosis_sctid), '') is not null
      or nullif(trim(e.diagnosis_term), '') is not null
      or (e.diagnosis_fhir is not null and e.diagnosis_fhir::text not in ('null', '{}'))
    )
    and (
      p_specialty is null
      or btrim(p_specialty) = ''
      or (
        nullif(trim(pr.specialization), '') is not null
        and lower(pr.specialization) = lower(btrim(p_specialty))
      )
      or (
        e.department_id is not null
        and exists (
          select 1 from public.departments d
          where d.id = e.department_id
            and d.hospital_id = p_hospital_id
            and nullif(trim(d.specialty), '') is not null
            and lower(d.specialty) = lower(btrim(p_specialty))
        )
      )
    )
  group by 1, 2
  order by count desc, display_name asc
  limit v_lim;
end;
$fn$;

comment on function public.get_top_diagnoses(uuid, integer, date, date, text) is
  'FHIR-aligned diagnosis analytics: group by SNOMED code (fallback UNKNOWN) with optional practitioner/department specialty filter.';

revoke all on function public.get_top_diagnoses(uuid, integer, date, date, text) from public;
grant execute on function public.get_top_diagnoses(uuid, integer, date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) get_prescription_patterns (MedicationRequest-style)
-- ---------------------------------------------------------------------------
create or replace function public.get_prescription_patterns(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date,
  p_specialty text default null
)
returns table (
  drug_name text,
  times_prescribed bigint,
  avg_duration numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select
    coalesce(nullif(trim(p.medicine_name), ''), '(unnamed)')::text as drug_name,
    count(*)::bigint as times_prescribed,
    round(
      avg(
        nullif(
          regexp_replace(coalesce(p.duration, ''), '[^0-9.]', '', 'g'),
          ''
        )::numeric
      ),
      2
    ) as avg_duration
  from public.prescriptions p
  inner join public.opd_encounters e on e.id = p.encounter_id
  left join public.practitioners pr
    on (pr.id = e.doctor_id or pr.user_id = e.doctor_id)
    and pr.hospital_id = p_hospital_id
  where e.hospital_id = p_hospital_id
    and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
    and (
      p_specialty is null
      or btrim(p_specialty) = ''
      or (
        nullif(trim(pr.specialization), '') is not null
        and lower(pr.specialization) = lower(btrim(p_specialty))
      )
      or (
        e.department_id is not null
        and exists (
          select 1 from public.departments d
          where d.id = e.department_id
            and d.hospital_id = p_hospital_id
            and nullif(trim(d.specialty), '') is not null
            and lower(d.specialty) = lower(btrim(p_specialty))
        )
      )
    )
  group by coalesce(nullif(trim(p.medicine_name), ''), '(unnamed)')
  order by times_prescribed desc, drug_name asc
  limit 200;
end;
$fn$;

revoke all on function public.get_prescription_patterns(uuid, date, date, text) from public;
grant execute on function public.get_prescription_patterns(uuid, date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) get_investigation_tat (ordered_at → resulted_at)
-- ---------------------------------------------------------------------------
create or replace function public.get_investigation_tat(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  avg_tat_hours numeric,
  median_tat_hours numeric,
  sample_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select
    round(avg(extract(epoch from (inv.resulted_at - inv.ordered_at)) / 3600.0)::numeric, 2) as avg_tat_hours,
    round(
      percentile_cont(0.5) within group (
        order by extract(epoch from (inv.resulted_at - inv.ordered_at)) / 3600.0
      )::numeric,
      2
    ) as median_tat_hours,
    count(*)::bigint as sample_count
  from public.investigations inv
  where inv.hospital_id = p_hospital_id
    and (inv.ordered_at at time zone 'utc')::date between p_start_date and p_end_date
    and inv.ordered_at is not null
    and inv.resulted_at is not null
    and inv.resulted_at >= inv.ordered_at
    and coalesce(lower(inv.status), '') <> 'cancelled';
end;
$fn$;

comment on function public.get_investigation_tat(uuid, date, date) is
  'DiagnosticReport-style turnaround: investigations.ordered_at → resulted_at.';

revoke all on function public.get_investigation_tat(uuid, date, date) from public;
grant execute on function public.get_investigation_tat(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) get_clinical_specialties_for_filter
-- ---------------------------------------------------------------------------
create or replace function public.get_clinical_specialties_for_filter(p_hospital_id uuid)
returns table (specialty text)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select distinct trim(pr.specialization)::text as specialty
  from public.practitioners pr
  where pr.hospital_id = p_hospital_id
    and nullif(trim(pr.specialization), '') is not null
  union
  select distinct trim(d.specialty)::text as specialty
  from public.departments d
  where d.hospital_id = p_hospital_id
    and nullif(trim(d.specialty), '') is not null
  order by 1;
end;
$fn$;

revoke all on function public.get_clinical_specialties_for_filter(uuid) from public;
grant execute on function public.get_clinical_specialties_for_filter(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10) get_avg_meds_per_encounter
-- ---------------------------------------------------------------------------
create or replace function public.get_avg_meds_per_encounter(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  avg_medications_per_encounter numeric,
  encounter_with_rx_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start_date > p_end_date then
    raise exception 'p_start_date must be <= p_end_date';
  end if;
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  with enc as (
    select e.id
    from public.opd_encounters e
    where e.hospital_id = p_hospital_id
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between p_start_date and p_end_date
  ),
  rx as (
    select p.encounter_id, count(*)::bigint as n
    from public.prescriptions p
    inner join enc on enc.id = p.encounter_id
    group by p.encounter_id
  )
  select
    case when count(*) = 0 then null::numeric
    else round(sum(rx.n)::numeric / count(*), 2)
    end as avg_medications_per_encounter,
    count(*)::bigint as encounter_with_rx_count
  from rx;
end;
$fn$;

revoke all on function public.get_avg_meds_per_encounter(uuid, date, date) from public;
grant execute on function public.get_avg_meds_per_encounter(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11) get_nabh_compliance_snapshot
-- ---------------------------------------------------------------------------
create or replace function public.get_nabh_compliance_snapshot(p_hospital_id uuid)
returns table (
  check_type public.nabh_compliance_check_type,
  department_id uuid,
  department_name text,
  score_percentage numeric,
  detail jsonb,
  last_calculated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select
    c.check_type,
    c.department_id,
    case
      when c.department_id is null then 'Hospital-wide'::text
      else coalesce(d.name, 'Department')::text
    end as department_name,
    c.score_percentage,
    c.detail,
    c.last_calculated_at
  from public.nabh_compliance_checks c
  left join public.departments d on d.id = c.department_id
  where c.hospital_id = p_hospital_id
  order by c.check_type, department_name nulls first;
end;
$fn$;

revoke all on function public.get_nabh_compliance_snapshot(uuid) from public;
grant execute on function public.get_nabh_compliance_snapshot(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) calculate_compliance_scores (nightly; service_role / postgres)
-- ---------------------------------------------------------------------------
create or replace function public.calculate_compliance_scores()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_from date := (timezone('utc', now()))::date - 30;
  v_to date := (timezone('utc', now()))::date;
begin
  for v_org in
    select distinct pr.hospital_id
    from public.practitioners pr
    where pr.hospital_id is not null
  loop
    delete from public.nabh_compliance_checks c where c.hospital_id = v_org;

    insert into public.nabh_compliance_checks (
      hospital_id, check_type, department_id, score_percentage, detail, last_calculated_at
    )
    with base as (
      select
        e.id,
        e.department_id,
        (e.chief_complaint is not null and btrim(e.chief_complaint) <> '')
          or (e.chief_complaints_fhir is not null and e.chief_complaints_fhir::text not in ('null', '[]'))
          as ok_cc,
        (e.quick_exam is not null and e.quick_exam::text not in ('null', '[]'))
          or (e.examination_term is not null and btrim(e.examination_term) <> '')
          or (e.examination_snomed is not null and btrim(e.examination_snomed::text) <> '')
          as ok_ex,
        (e.diagnosis_term is not null and btrim(e.diagnosis_term) <> '')
          or (e.diagnosis_snomed is not null and btrim(e.diagnosis_snomed) <> '')
          or (e.diagnosis_sctid is not null and btrim(e.diagnosis_sctid) <> '')
          or (e.diagnosis_fhir is not null and e.diagnosis_fhir::text not in ('null', '{}'))
          as ok_dx,
        e.plan_details is not null and e.plan_details::text not in ('null', '{}')
          as ok_plan,
        (e.follow_up_date is not null and btrim(e.follow_up_date::text) <> '')
          or (
            e.plan_details is not null
            and e.plan_details ? 'follow_up_date'
            and nullif(btrim(e.plan_details->>'follow_up_date'), '') is not null
          )
          as ok_fu
      from public.opd_encounters e
      where e.hospital_id = v_org
        and e.status = 'completed'
        and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_from and v_to
    ),
    scored as (
      select
        department_id,
        count(*)::bigint as n_total,
        count(*) filter (
          where ok_cc and ok_ex and ok_dx and ok_plan and ok_fu
        )::bigint as n_ok,
        count(*) filter (where not ok_cc)::bigint as miss_cc,
        count(*) filter (where not ok_ex)::bigint as miss_ex,
        count(*) filter (where not ok_dx)::bigint as miss_dx,
        count(*) filter (where not ok_plan)::bigint as miss_plan,
        count(*) filter (where not ok_fu)::bigint as miss_fu
      from base
      group by grouping sets ((department_id), ())
    )
    select
      v_org,
      'documentation_complete'::public.nabh_compliance_check_type,
      scored.department_id,
      case
        when scored.n_total = 0 then null::numeric
        else round(100.0 * scored.n_ok::numeric / scored.n_total::numeric, 2)
      end,
      jsonb_build_object(
        'period_start', v_from,
        'period_end', v_to,
        'encounters_scored', scored.n_total,
        'missing_chief_complaint', scored.miss_cc,
        'missing_examination_findings', scored.miss_ex,
        'missing_diagnosis', scored.miss_dx,
        'missing_treatment_plan', scored.miss_plan,
        'missing_follow_up_instructions', scored.miss_fu
      ),
      now()
    from scored
    where coalesce(scored.n_total, 0) > 0;

    insert into public.nabh_compliance_checks (
      hospital_id, check_type, department_id, score_percentage, detail, last_calculated_at
    )
    with proc_enc as (
      select e.id
      from public.opd_encounters e
      where e.hospital_id = v_org
        and e.status = 'completed'
        and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_from and v_to
        and (
          (e.procedures_fhir is not null and jsonb_typeof(e.procedures_fhir) = 'array' and jsonb_array_length(e.procedures_fhir) > 0)
          or (e.procedures is not null and btrim(e.procedures::text) <> '')
        )
    ),
    consent_hit as (
      select pe.id
      from proc_enc pe
      where exists (
        select 1 from public.clinical_procedure_consents c
        where c.opd_encounter_id = pe.id
          and c.hospital_id = v_org
          and c.signed_at <= (select oe.updated_at from public.opd_encounters oe where oe.id = pe.id)
      )
    ),
    dept_map as (
      select e.department_id, count(*)::bigint as n_proc
      from public.opd_encounters e
      inner join proc_enc pe on pe.id = e.id
      group by e.department_id
    ),
    dept_signed as (
      select e.department_id, count(*)::bigint as n_ok
      from public.opd_encounters e
      inner join consent_hit ch on ch.id = e.id
      group by e.department_id
    ),
    rolled as (
      select
        d.department_id,
        d.n_proc,
        coalesce(s.n_ok, 0::bigint) as n_ok
      from dept_map d
      left join dept_signed s on s.department_id = d.department_id
    ),
    hospital_agg as (
      select
        coalesce(sum(n_proc), 0)::bigint as n_proc,
        coalesce(sum(n_ok), 0)::bigint as n_ok
      from rolled
    )
    select v_org, 'consent_present'::public.nabh_compliance_check_type, r.department_id,
      case when r.n_proc = 0 then null::numeric else round(100.0 * r.n_ok::numeric / r.n_proc::numeric, 2) end,
      jsonb_build_object('procedure_encounters', r.n_proc, 'with_signed_consent', r.n_ok, 'period_start', v_from, 'period_end', v_to),
      now()
    from rolled r
    union all
    select v_org, 'consent_present'::public.nabh_compliance_check_type, null::uuid,
      case when h.n_proc = 0 then null::numeric else round(100.0 * h.n_ok::numeric / h.n_proc::numeric, 2) end,
      jsonb_build_object('procedure_encounters', h.n_proc, 'with_signed_consent', h.n_ok, 'period_start', v_from, 'period_end', v_to),
      now()
    from hospital_agg h
    where h.n_proc > 0;

    insert into public.nabh_compliance_checks (
      hospital_id, check_type, department_id, score_percentage, detail, last_calculated_at
    )
    with base as (
      select
        e.department_id,
        e.created_at,
        e.updated_at
      from public.opd_encounters e
      where e.hospital_id = v_org
        and e.status = 'completed'
        and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_from and v_to
    ),
    scored as (
      select
        department_id,
        count(*)::bigint as n_total,
        count(*) filter (where updated_at <= created_at + interval '24 hours')::bigint as n_ok
      from base
      group by grouping sets ((department_id), ())
    )
    select
      v_org,
      'note_timeliness'::public.nabh_compliance_check_type,
      scored.department_id,
      case
        when scored.n_total = 0 then null::numeric
        else round(100.0 * scored.n_ok::numeric / scored.n_total::numeric, 2)
      end,
      jsonb_build_object(
        'period_start', v_from,
        'period_end', v_to,
        'completed_encounters', scored.n_total,
        'notes_within_24h', scored.n_ok
      ),
      now()
    from scored
    where coalesce(scored.n_total, 0) > 0;
  end loop;
end;
$fn$;

comment on function public.calculate_compliance_scores() is
  'NABH §5.3 documentation / consent / note timeliness; refresh nabh_compliance_checks (intended nightly via pg_cron).';

revoke all on function public.calculate_compliance_scores() from public;
grant execute on function public.calculate_compliance_scores() to service_role;

-- ---------------------------------------------------------------------------
-- refresh_nabh_compliance_for_hospital — admin UI (single hospital)
-- ---------------------------------------------------------------------------
create or replace function public.refresh_nabh_compliance_for_hospital(p_hospital_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_hospital_id;
  v_from date := (timezone('utc', now()))::date - 30;
  v_to date := (timezone('utc', now()))::date;
begin
  if p_hospital_id is null then
    raise exception 'p_hospital_id required';
  end if;
  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  delete from public.nabh_compliance_checks c where c.hospital_id = v_org;

  insert into public.nabh_compliance_checks (
    hospital_id, check_type, department_id, score_percentage, detail, last_calculated_at
  )
  with base as (
    select
      e.id,
      e.department_id,
      (e.chief_complaint is not null and btrim(e.chief_complaint) <> '')
        or (e.chief_complaints_fhir is not null and e.chief_complaints_fhir::text not in ('null', '[]'))
        as ok_cc,
      (e.quick_exam is not null and e.quick_exam::text not in ('null', '[]'))
        or (e.examination_term is not null and btrim(e.examination_term) <> '')
        or (e.examination_snomed is not null and btrim(e.examination_snomed::text) <> '')
        as ok_ex,
      (e.diagnosis_term is not null and btrim(e.diagnosis_term) <> '')
        or (e.diagnosis_snomed is not null and btrim(e.diagnosis_snomed) <> '')
        or (e.diagnosis_sctid is not null and btrim(e.diagnosis_sctid) <> '')
        or (e.diagnosis_fhir is not null and e.diagnosis_fhir::text not in ('null', '{}'))
        as ok_dx,
      e.plan_details is not null and e.plan_details::text not in ('null', '{}')
        as ok_plan,
      (e.follow_up_date is not null and btrim(e.follow_up_date::text) <> '')
        or (
          e.plan_details is not null
          and e.plan_details ? 'follow_up_date'
          and nullif(btrim(e.plan_details->>'follow_up_date'), '') is not null
        )
        as ok_fu
    from public.opd_encounters e
    where e.hospital_id = v_org
      and e.status = 'completed'
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_from and v_to
  ),
  scored as (
    select
      department_id,
      count(*)::bigint as n_total,
      count(*) filter (
        where ok_cc and ok_ex and ok_dx and ok_plan and ok_fu
      )::bigint as n_ok,
      count(*) filter (where not ok_cc)::bigint as miss_cc,
      count(*) filter (where not ok_ex)::bigint as miss_ex,
      count(*) filter (where not ok_dx)::bigint as miss_dx,
      count(*) filter (where not ok_plan)::bigint as miss_plan,
      count(*) filter (where not ok_fu)::bigint as miss_fu
    from base
    group by grouping sets ((department_id), ())
  )
  select
    v_org,
    'documentation_complete'::public.nabh_compliance_check_type,
    scored.department_id,
    case
      when scored.n_total = 0 then null::numeric
      else round(100.0 * scored.n_ok::numeric / scored.n_total::numeric, 2)
    end,
    jsonb_build_object(
      'period_start', v_from,
      'period_end', v_to,
      'encounters_scored', scored.n_total,
      'missing_chief_complaint', scored.miss_cc,
      'missing_examination_findings', scored.miss_ex,
      'missing_diagnosis', scored.miss_dx,
      'missing_treatment_plan', scored.miss_plan,
      'missing_follow_up_instructions', scored.miss_fu
    ),
    now()
  from scored
  where coalesce(scored.n_total, 0) > 0;

  insert into public.nabh_compliance_checks (
    hospital_id, check_type, department_id, score_percentage, detail, last_calculated_at
  )
  with proc_enc as (
    select e.id
    from public.opd_encounters e
    where e.hospital_id = v_org
      and e.status = 'completed'
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_from and v_to
      and (
        (e.procedures_fhir is not null and jsonb_typeof(e.procedures_fhir) = 'array' and jsonb_array_length(e.procedures_fhir) > 0)
        or (e.procedures is not null and btrim(e.procedures::text) <> '')
      )
  ),
  consent_hit as (
    select pe.id
    from proc_enc pe
    where exists (
      select 1 from public.clinical_procedure_consents c
      where c.opd_encounter_id = pe.id
        and c.hospital_id = v_org
        and c.signed_at <= (select oe.updated_at from public.opd_encounters oe where oe.id = pe.id)
    )
  ),
  dept_map as (
    select e.department_id, count(*)::bigint as n_proc
    from public.opd_encounters e
    inner join proc_enc pe on pe.id = e.id
    group by e.department_id
  ),
  dept_signed as (
    select e.department_id, count(*)::bigint as n_ok
    from public.opd_encounters e
    inner join consent_hit ch on ch.id = e.id
    group by e.department_id
  ),
  rolled as (
    select
      d.department_id,
      d.n_proc,
      coalesce(s.n_ok, 0::bigint) as n_ok
    from dept_map d
    left join dept_signed s on s.department_id = d.department_id
  ),
  hospital_agg as (
    select
      coalesce(sum(n_proc), 0)::bigint as n_proc,
      coalesce(sum(n_ok), 0)::bigint as n_ok
    from rolled
  )
  select v_org, 'consent_present'::public.nabh_compliance_check_type, r.department_id,
    case when r.n_proc = 0 then null::numeric else round(100.0 * r.n_ok::numeric / r.n_proc::numeric, 2) end,
    jsonb_build_object('procedure_encounters', r.n_proc, 'with_signed_consent', r.n_ok, 'period_start', v_from, 'period_end', v_to),
    now()
  from rolled r
  union all
  select v_org, 'consent_present'::public.nabh_compliance_check_type, null::uuid,
    case when h.n_proc = 0 then null::numeric else round(100.0 * h.n_ok::numeric / h.n_proc::numeric, 2) end,
    jsonb_build_object('procedure_encounters', h.n_proc, 'with_signed_consent', h.n_ok, 'period_start', v_from, 'period_end', v_to),
    now()
  from hospital_agg h
  where h.n_proc > 0;

  insert into public.nabh_compliance_checks (
    hospital_id, check_type, department_id, score_percentage, detail, last_calculated_at
  )
  with base as (
    select
      e.department_id,
      e.created_at,
      e.updated_at
    from public.opd_encounters e
    where e.hospital_id = v_org
      and e.status = 'completed'
      and coalesce(e.encounter_date, (e.created_at at time zone 'utc')::date) between v_from and v_to
  ),
  scored as (
    select
      department_id,
      count(*)::bigint as n_total,
      count(*) filter (where updated_at <= created_at + interval '24 hours')::bigint as n_ok
    from base
    group by grouping sets ((department_id), ())
  )
  select
    v_org,
    'note_timeliness'::public.nabh_compliance_check_type,
    scored.department_id,
    case
      when scored.n_total = 0 then null::numeric
      else round(100.0 * scored.n_ok::numeric / scored.n_total::numeric, 2)
    end,
    jsonb_build_object(
      'period_start', v_from,
      'period_end', v_to,
      'completed_encounters', scored.n_total,
      'notes_within_24h', scored.n_ok
    ),
    now()
  from scored
  where coalesce(scored.n_total, 0) > 0;
end;
$fn$;

revoke all on function public.refresh_nabh_compliance_for_hospital(uuid) from public;
grant execute on function public.refresh_nabh_compliance_for_hospital(uuid) to authenticated, service_role;

-- If pg_cron is enabled: select cron.schedule(
--   'nabh-calculate-compliance-scores-utc-0200',
--   '0 2 * * *',
--   'select public.calculate_compliance_scores()'
-- );
