-- Drop legacy 4-arg overload (p_specialty); app + canonical migration use (p_hospital_id, p_start_date, p_end_date) only.

drop function if exists public.get_avg_meds_per_encounter(uuid, date, date, text);

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
