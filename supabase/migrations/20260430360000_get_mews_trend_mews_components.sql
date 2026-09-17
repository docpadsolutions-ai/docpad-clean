-- Include mews_components on each get_mews_trend row for MEWS vitals card UI.

create or replace function public.get_mews_trend(p_admission_id uuid)
returns table (
  recorded_at timestamptz,
  mews_score integer,
  mews_alert_level text,
  mews_components jsonb
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
    v.mews_alert_level,
    coalesce(v.mews_components, '[]'::jsonb)
  from public.ipd_nursing_vitals v
  where v.admission_id = p_admission_id
    and v.mews_score is not null
  order by v.recorded_at asc;
end;
$fn$;
