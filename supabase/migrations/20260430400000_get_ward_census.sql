-- Ward Census tab: one row per active IPD admission with ward, bed, patient, latest nursing vitals + MEWS.

create or replace function public.get_ward_census(p_hospital_id uuid)
returns table (
  ward_id uuid,
  ward_name text,
  admission_id uuid,
  patient_id uuid,
  bed_id uuid,
  bed_number text,
  first_name text,
  last_name text,
  full_name text,
  date_of_birth date,
  sex text,
  primary_diagnosis_display text,
  los_days integer,
  admitted_at timestamptz,
  latest_vitals_at timestamptz,
  pulse numeric,
  blood_pressure text,
  spo2 numeric,
  temperature numeric,
  mews_score integer,
  mews_alert_level text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_hospital_id is null then
    raise exception 'p_hospital_id required';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = p_hospital_id
      and (pr.user_id = auth.uid() or pr.id = auth.uid())
  ) then
    raise exception 'not authorized for this hospital';
  end if;

  return query
  select
    w.id as ward_id,
    coalesce(w.name, 'Unassigned') as ward_name,
    a.id as admission_id,
    a.patient_id,
    b.id as bed_id,
    b.bed_number::text as bed_number,
    null::text as first_name,
    null::text as last_name,
    p.full_name::text as full_name,
    p.date_of_birth::date as date_of_birth,
    p.sex::text as sex,
    a.primary_diagnosis_display::text as primary_diagnosis_display,
    case
      when a.admitted_at is not null then
        greatest(
          1,
          ((timezone('utc', now()))::date - (a.admitted_at at time zone 'UTC')::date + 1)::integer
        )
      else 1
    end as los_days,
    a.admitted_at,
    nv.recorded_at as latest_vitals_at,
    nv.pulse,
    nv.blood_pressure,
    nv.spo2,
    nv.temperature,
    nv.mews_score,
    nv.mews_alert_level::text
  from public.ipd_admissions a
  inner join public.patients p on p.id = a.patient_id
  left join public.ipd_wards w on w.id = a.ward_id
  left join public.ipd_beds b on b.id = a.bed_id
  left join lateral (
    select
      v.recorded_at,
      v.pulse,
      v.blood_pressure,
      v.spo2,
      v.temperature,
      v.mews_score,
      v.mews_alert_level
    from public.ipd_nursing_vitals v
    where v.admission_id = a.id
    order by v.recorded_at desc
    limit 1
  ) nv on true
  where a.hospital_id = p_hospital_id
    and a.discharged_at is null
    and (a.status is null or a.status not in ('discharged', 'cancelled'));
end;
$fn$;

grant execute on function public.get_ward_census(uuid) to authenticated, service_role;

comment on function public.get_ward_census(uuid) is
  'Active IPD admissions for a hospital with ward/bed/patient and latest nursing vitals + MEWS (Ward Census UI).';
