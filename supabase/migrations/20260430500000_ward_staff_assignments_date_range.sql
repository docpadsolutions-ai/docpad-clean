-- Ensure start_date / end_date exist and backfill; drop legacy single-day unique index; nurse RPC.

-- 1) Columns (no-op when table already created with start_date / end_date from prior migration)
alter table public.ward_staff_assignments
  add column if not exists start_date date;
alter table public.ward_staff_assignments
  add column if not exists end_date date;

-- 2) Fill nulls for rows missing either bound
update public.ward_staff_assignments
set start_date = coalesce(start_date, (timezone('utc', now()))::date)
where start_date is null;
update public.ward_staff_assignments
set end_date = coalesce(end_date, coalesce(start_date, (timezone('utc', now()))::date))
where end_date is null;

-- 3) Legacy single-day unique index (superseded by range index on fresh installs)
drop index if exists public.ward_staff_assignments_practitioner_ward_date_shift_uidx;

-- 4) RPC: assignment active on calendar day p_date
create or replace function public.get_nurse_ward_patients(
  p_nurse_id uuid,
  p_hospital_id uuid,
  p_shift text,
  p_date date
)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_result jsonb;
begin
  with cand as (
    select
      w.name as ward_name_ord,
      b.bed_number as bed_num_ord,
      jsonb_build_object(
        'admission_id', a.id,
        'admission_number', a.admission_number,
        'admitted_at', a.admitted_at,
        'primary_diagnosis', a.primary_diagnosis_display,
        'patient_id', p.id,
        'patient_name', p.full_name,
        'patient_age', extract(year from age(p.date_of_birth))::int,
        'patient_sex', p.sex,
        'blood_group', p.blood_group,
        'known_allergies', p.known_allergies,
        'ward_id', w.id,
        'ward_name', w.name,
        'bed_number', b.bed_number,
        'bed_type', b.bed_type,
        'doctor_name', dr.full_name,
        'los_days', extract(day from now() - a.admitted_at)::int,
        'latest_bp', lv.bp_systolic || '/' || lv.bp_diastolic,
        'latest_hr', lv.heart_rate,
        'latest_temp_c', lv.temperature_c,
        'latest_spo2', lv.spo2,
        'latest_pain', lv.pain_score,
        'latest_vitals_at', lv.recorded_at,
        'pending_meds', (
          select count(*)
          from public.ipd_mar m
          where m.admission_id = a.id
            and m.scheduled_date = p_date
            and m.status = 'pending'
        ),
        'pending_orders', (
          select count(*)
          from public.ipd_doctor_orders o
          where o.admission_id = a.id
            and o.order_category = 'nursing'
            and o.status = 'active'
            and o.acknowledged_at is null
        )
      ) as obj,
      row_number() over (
        partition by a.id
        order by
          case
            when p_shift is not null and lower(trim(wsa.shift)) = lower(trim(p_shift)) then 0
            when lower(trim(wsa.shift)) = 'general' then 1
            else 2
          end,
          wsa.id
      ) as rk
    from public.ward_staff_assignments wsa
    join public.ipd_wards w on w.id = wsa.ward_id
    join public.ipd_admissions a on a.ward_id = w.id and a.status = 'in-progress'
    join public.patients p on p.id = a.patient_id
    join public.ipd_beds b on b.id = a.bed_id
    left join public.practitioners dr on dr.id = a.admitting_doctor_id
    left join lateral (
      select bp_systolic, bp_diastolic, heart_rate, temperature_c, spo2, pain_score, recorded_at
      from public.ipd_vitals
      where admission_id = a.id
      order by recorded_at desc
      limit 1
    ) lv on true
    where wsa.practitioner_id = p_nurse_id
      and wsa.hospital_id = p_hospital_id
      and wsa.start_date <= p_date
      and wsa.end_date >= p_date
      and wsa.is_active = true
      and (wsa.shift = 'general' or p_shift is null or lower(wsa.shift) = lower(p_shift))
  )
  select jsonb_agg(obj order by ward_name_ord, bed_num_ord nulls last)
  into v_result
  from cand
  where rk = 1;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;
