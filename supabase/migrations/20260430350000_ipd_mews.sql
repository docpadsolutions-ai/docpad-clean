-- MEWS (Modified Early Warning Score) on IPD nursing vitals: AVPU + computed score/alert/components.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.ipd_nursing_vitals
  add column if not exists avpu text;

alter table public.ipd_nursing_vitals
  add column if not exists mews_score integer;

alter table public.ipd_nursing_vitals
  add column if not exists mews_alert_level text;

alter table public.ipd_nursing_vitals
  add column if not exists mews_components jsonb not null default '[]'::jsonb;

comment on column public.ipd_nursing_vitals.avpu is
  'AVPU consciousness: A=Alert, V=Voice, P=Pain, U=Unresponsive (MEWS).';

comment on column public.ipd_nursing_vitals.mews_score is
  'MEWS total (extended with SpO₂); 0–2 normal, 3–4 escalate, ≥5 critical.';

comment on column public.ipd_nursing_vitals.mews_alert_level is
  'normal | escalate | critical — derived from mews_score.';

comment on column public.ipd_nursing_vitals.mews_components is
  'JSON array: [{parameter, value, score}, ...] per parameter contribution.';

-- ---------------------------------------------------------------------------
-- Parse systolic BP from "120/80" text
-- ---------------------------------------------------------------------------
create or replace function public.parse_bp_systolic(p_bp text)
returns numeric
language plpgsql
immutable
set search_path = public
as $fn$
declare
  p text;
  x numeric;
begin
  if p_bp is null or btrim(p_bp) = '' then
    return null;
  end if;
  p := split_part(btrim(p_bp), '/', 1);
  if p = '' then
    return null;
  end if;
  x := p::numeric;
  return x;
exception
  when others then
    return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Core MEWS JSON: score, alert_level, components
-- ---------------------------------------------------------------------------
create or replace function public.mews_json_for_inputs(
  p_rr numeric,
  p_spo2 numeric,
  p_temp numeric,
  p_pulse numeric,
  p_sbp numeric,
  p_avpu text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_hr int;
  v_rr int;
  v_temp int;
  v_sbp int;
  v_spo2 int;
  v_avpu int;
  v_avpu_u text;
  v_total int;
  v_level text;
  v_comp jsonb := '[]'::jsonb;
  v_hr_disp text;
  v_rr_disp text;
  v_temp_disp text;
  v_sbp_disp text;
  v_spo2_disp text;
  v_avpu_disp text;
begin
  -- Heart rate (Subbe MEWS)
  v_hr := case
    when p_pulse is null then 0
    when p_pulse <= 40 then 2
    when p_pulse <= 50 then 1
    when p_pulse <= 100 then 0
    when p_pulse <= 110 then 1
    when p_pulse <= 129 then 2
    else 3
  end;
  v_hr_disp := case when p_pulse is null then '—' else round(p_pulse::numeric, 1)::text end;

  -- Respiratory rate
  v_rr := case
    when p_rr is null then 0
    when p_rr <= 8 then 2
    when p_rr <= 14 then 0
    when p_rr <= 20 then 1
    when p_rr <= 29 then 2
    else 3
  end;
  v_rr_disp := case when p_rr is null then '—' else round(p_rr::numeric, 1)::text end;

  -- Temperature °C
  v_temp := case
    when p_temp is null then 0
    when p_temp <= 35 then 2
    when p_temp < 38.1 then 0
    else 2
  end;
  v_temp_disp := case when p_temp is null then '—' else round(p_temp::numeric, 1)::text end;

  -- Systolic BP
  v_sbp := case
    when p_sbp is null then 0
    when p_sbp <= 70 then 3
    when p_sbp <= 80 then 2
    when p_sbp <= 100 then 1
    when p_sbp <= 199 then 0
    else 2
  end;
  v_sbp_disp := case when p_sbp is null then '—' else round(p_sbp::numeric, 0)::text end;

  -- SpO₂ (extended MEWS / NEWS-style band)
  v_spo2 := case
    when p_spo2 is null then 0
    when p_spo2 >= 96 then 0
    when p_spo2 >= 94 then 1
    when p_spo2 >= 92 then 2
    else 3
  end;
  v_spo2_disp := case when p_spo2 is null then '—' else round(p_spo2::numeric, 0)::text end;

  v_avpu_u := upper(left(btrim(coalesce(p_avpu, 'A')), 1));
  if v_avpu_u not in ('A', 'V', 'P', 'U') then
    v_avpu_u := 'A';
  end if;
  v_avpu := case v_avpu_u
    when 'A' then 0
    when 'V' then 1
    when 'P' then 2
    else 3
  end;
  v_avpu_disp := case v_avpu_u
    when 'A' then 'Alert'
    when 'V' then 'Voice'
    when 'P' then 'Pain'
    else 'Unresponsive'
  end;

  v_total := v_hr + v_rr + v_temp + v_sbp + v_spo2 + v_avpu;

  v_level := case
    when v_total <= 2 then 'normal'
    when v_total <= 4 then 'escalate'
    else 'critical'
  end;

  v_comp := v_comp || jsonb_build_array(
    jsonb_build_object('parameter', 'Heart rate (bpm)', 'value', v_hr_disp, 'score', v_hr),
    jsonb_build_object('parameter', 'Respiratory rate (/min)', 'value', v_rr_disp, 'score', v_rr),
    jsonb_build_object('parameter', 'Temperature (°C)', 'value', v_temp_disp, 'score', v_temp),
    jsonb_build_object('parameter', 'Systolic BP (mmHg)', 'value', v_sbp_disp, 'score', v_sbp),
    jsonb_build_object('parameter', 'SpO₂ (%)', 'value', v_spo2_disp, 'score', v_spo2),
    jsonb_build_object('parameter', 'AVPU', 'value', v_avpu_disp, 'score', v_avpu)
  );

  return jsonb_build_object(
    'score', v_total,
    'alert_level', v_level,
    'components', v_comp
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: compute MEWS + normalize avpu
-- ---------------------------------------------------------------------------
create or replace function public.ipd_nursing_vitals_before_ins_mews()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_sbp numeric;
  v_json jsonb;
  v_avpu text;
begin
  v_sbp := public.parse_bp_systolic(new.blood_pressure);
  v_avpu := upper(left(btrim(coalesce(new.avpu, 'A')), 1));
  if v_avpu not in ('A', 'V', 'P', 'U') then
    v_avpu := 'A';
  end if;
  new.avpu := v_avpu;

  v_json := public.mews_json_for_inputs(
    new.respiratory_rate,
    new.spo2,
    new.temperature,
    new.pulse,
    v_sbp,
    v_avpu
  );

  new.mews_score := (v_json->>'score')::integer;
  new.mews_alert_level := v_json->>'alert_level';
  new.mews_components := coalesce(v_json->'components', '[]'::jsonb);

  return new;
end;
$fn$;

drop trigger if exists ipd_nursing_vitals_before_ins_mews on public.ipd_nursing_vitals;
create trigger ipd_nursing_vitals_before_ins_mews
  before insert on public.ipd_nursing_vitals
  for each row
  execute function public.ipd_nursing_vitals_before_ins_mews();

-- Backfill existing rows (best-effort)
update public.ipd_nursing_vitals v
set
  avpu = coalesce(upper(left(btrim(v.avpu), 1)), 'A'),
  mews_score = (public.mews_json_for_inputs(
    v.respiratory_rate,
    v.spo2,
    v.temperature,
    v.pulse,
    public.parse_bp_systolic(v.blood_pressure),
    coalesce(upper(left(btrim(v.avpu), 1)), 'A')
  )->>'score')::integer,
  mews_alert_level = public.mews_json_for_inputs(
    v.respiratory_rate,
    v.spo2,
    v.temperature,
    v.pulse,
    public.parse_bp_systolic(v.blood_pressure),
    coalesce(upper(left(btrim(v.avpu), 1)), 'A')
  )->>'alert_level',
  mews_components = coalesce(
    (public.mews_json_for_inputs(
      v.respiratory_rate,
      v.spo2,
      v.temperature,
      v.pulse,
      public.parse_bp_systolic(v.blood_pressure),
      coalesce(upper(left(btrim(v.avpu), 1)), 'A')
    )->'components'),
    '[]'::jsonb
  )
where v.mews_score is null;

-- ---------------------------------------------------------------------------
-- RPC: ward MEWS summary (latest vitals per active admission)
-- ---------------------------------------------------------------------------
create or replace function public.get_ward_mews_summary(p_hospital_id uuid)
returns table (
  admission_id uuid,
  mews_score integer,
  mews_alert_level text,
  recorded_at timestamptz
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
  with active as (
    select ia.id as admission_id
    from public.ipd_admissions ia
    where ia.hospital_id = p_hospital_id
      and ia.discharged_at is null
      and (ia.status is null or ia.status not in ('discharged', 'cancelled'))
  ),
  latest as (
    select distinct on (v.admission_id)
      v.admission_id,
      v.mews_score,
      v.mews_alert_level,
      v.recorded_at
    from public.ipd_nursing_vitals v
    inner join active a on a.admission_id = v.admission_id
    order by v.admission_id, v.recorded_at desc
  )
  select
    a.admission_id,
    l.mews_score,
    l.mews_alert_level,
    l.recorded_at
  from active a
  left join latest l on l.admission_id = a.admission_id;
end;
$fn$;

grant execute on function public.get_ward_mews_summary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC: MEWS trend for one admission
-- ---------------------------------------------------------------------------
create or replace function public.get_mews_trend(p_admission_id uuid)
returns table (
  recorded_at timestamptz,
  mews_score integer,
  mews_alert_level text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_admission_id is null then
    raise exception 'p_admission_id required';
  end if;

  select ia.hospital_id into v_hospital
  from public.ipd_admissions ia
  where ia.id = p_admission_id;

  if v_hospital is null then
    raise exception 'admission not found';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = v_hospital
      and (pr.user_id = auth.uid() or pr.id = auth.uid())
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    v.recorded_at,
    v.mews_score,
    v.mews_alert_level
  from public.ipd_nursing_vitals v
  where v.admission_id = p_admission_id
    and v.mews_score is not null
  order by v.recorded_at asc;
end;
$fn$;

grant execute on function public.get_mews_trend(uuid) to authenticated, service_role;
