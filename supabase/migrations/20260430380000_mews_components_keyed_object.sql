-- Store MEWS per-parameter breakdown as a keyed JSON object (matches RPC / app expectations).

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
  v_comp jsonb;
begin
  v_hr := case
    when p_pulse is null then 0
    when p_pulse <= 40 then 2
    when p_pulse <= 50 then 1
    when p_pulse <= 100 then 0
    when p_pulse <= 110 then 1
    when p_pulse <= 129 then 2
    else 3
  end;

  v_rr := case
    when p_rr is null then 0
    when p_rr <= 8 then 2
    when p_rr <= 14 then 0
    when p_rr <= 20 then 1
    when p_rr <= 29 then 2
    else 3
  end;

  v_temp := case
    when p_temp is null then 0
    when p_temp <= 35 then 2
    when p_temp < 38.1 then 0
    else 2
  end;

  v_sbp := case
    when p_sbp is null then 0
    when p_sbp <= 70 then 3
    when p_sbp <= 80 then 2
    when p_sbp <= 100 then 1
    when p_sbp <= 199 then 0
    else 2
  end;

  v_spo2 := case
    when p_spo2 is null then 0
    when p_spo2 >= 96 then 0
    when p_spo2 >= 94 then 1
    when p_spo2 >= 92 then 2
    else 3
  end;

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

  v_total := v_hr + v_rr + v_temp + v_sbp + v_spo2 + v_avpu;

  v_level := case
    when v_total <= 2 then 'normal'
    when v_total <= 4 then 'escalate'
    else 'critical'
  end;

  v_comp := jsonb_build_object(
    'respiratory_rate',
    jsonb_build_object(
      'value',
      case when p_rr is null then null else round(p_rr::numeric, 1)::numeric end,
      'score',
      v_rr
    ),
    'spo2',
    jsonb_build_object(
      'value',
      case when p_spo2 is null then null else round(p_spo2::numeric, 0)::numeric end,
      'score',
      v_spo2
    ),
    'temperature',
    jsonb_build_object(
      'value',
      case when p_temp is null then null else round(p_temp::numeric, 1)::numeric end,
      'score',
      v_temp
    ),
    'systolic_bp',
    jsonb_build_object(
      'value',
      case when p_sbp is null then null else round(p_sbp::numeric, 0)::numeric end,
      'score',
      v_sbp
    ),
    'heart_rate',
    jsonb_build_object(
      'value',
      case when p_pulse is null then null else round(p_pulse::numeric, 1)::numeric end,
      'score',
      v_hr
    ),
    'avpu',
    jsonb_build_object(
      'value',
      v_avpu_u,
      'score',
      v_avpu
    )
  );

  return jsonb_build_object(
    'score',
    v_total,
    'alert_level',
    v_level,
    'components',
    v_comp
  );
end;
$fn$;

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
  new.mews_components := coalesce(v_json->'components', '{}'::jsonb);

  return new;
end;
$fn$;

comment on column public.ipd_nursing_vitals.mews_components is
  'JSON object: { respiratory_rate|spo2|temperature|systolic_bp|heart_rate|avpu: { value, score } }. Legacy rows may still hold a [{parameter,value,score}] array.';

alter table public.ipd_nursing_vitals
  alter column mews_components set default '{}'::jsonb;

update public.ipd_nursing_vitals v
set
  mews_components = coalesce(
    (public.mews_json_for_inputs(
      v.respiratory_rate,
      v.spo2,
      v.temperature,
      v.pulse,
      public.parse_bp_systolic(v.blood_pressure),
      coalesce(upper(left(btrim(v.avpu), 1)), 'A')
    )->'components'),
    '{}'::jsonb
  );
