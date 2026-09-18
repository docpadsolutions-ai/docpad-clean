-- Hospital-scoped analytics RPCs (SECURITY DEFINER) with explicit p_hospital_id + session check.
-- Complements get_revenue_by_charge_type (auth-derived hospital only).

-- ---------------------------------------------------------------------------
-- Shared: assert caller belongs to p_hospital_id
-- ---------------------------------------------------------------------------

create or replace function public._billing_assert_hospital_access(p_hospital_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_hospital_id is null then
    raise exception 'p_hospital_id required';
  end if;

  select pr.hospital_id
  into v_hospital
  from public.practitioners pr
  where pr.user_id = auth.uid() or pr.id = auth.uid()
  limit 1;

  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  if v_hospital is distinct from p_hospital_id then
    raise exception 'forbidden';
  end if;
end;
$fn$;

revoke all on function public._billing_assert_hospital_access(uuid) from public;
grant execute on function public._billing_assert_hospital_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_revenue_by_department
-- ---------------------------------------------------------------------------

create or replace function public.get_revenue_by_department(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  department_id uuid,
  department_name text,
  total_revenue numeric,
  patient_count bigint,
  avg_revenue_per_patient numeric
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
  with inv as (
    select
      i.patient_id,
      i.total_gross,
      i.department_id
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and (i.invoice_date at time zone 'utc')::date between p_start_date and p_end_date
      and i.status is distinct from 'cancelled'
  )
  select
    inv.department_id,
    coalesce(dep.name, 'Unassigned')::text as department_name,
    coalesce(sum(inv.total_gross), 0) as total_revenue,
    count(distinct inv.patient_id)::bigint as patient_count,
    case
      when count(distinct inv.patient_id) = 0 then 0::numeric
      else round(sum(inv.total_gross) / (count(distinct inv.patient_id))::numeric, 2)
    end as avg_revenue_per_patient
  from inv
  left join public.departments dep on dep.id = inv.department_id
  group by inv.department_id, dep.name
  order by total_revenue desc;
end;
$fn$;

comment on function public.get_revenue_by_department(uuid, date, date) is
  'Billed gross by invoice.department_id in UTC date range; unassigned when department_id is null.';

-- ---------------------------------------------------------------------------
-- get_revenue_by_category (same measure as get_revenue_by_charge_type; explicit hospital + dates)
-- ---------------------------------------------------------------------------

create or replace function public.get_revenue_by_category(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  charge_category text,
  total_billed numeric,
  total_collected numeric,
  collection_rate numeric
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
  with inv as (
    select i.id, i.total_gross
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and (i.invoice_date at time zone 'utc')::date between p_start_date and p_end_date
  ),
  pay_by_inv as (
    select p.invoice_id, coalesce(sum(p.amount) filter (where p.status = 'confirmed'), 0) as paid
    from public.payments p
    where p.hospital_id = p_hospital_id
      and p.invoice_id is not null
    group by p.invoice_id
  ),
  lines as (
    select
      li.invoice_id,
      coalesce(d.category::text, 'other') as charge_category,
      li.net_amount
    from public.invoice_line_items li
    inner join inv on inv.id = li.invoice_id
    left join public.charge_items ci on ci.id = li.charge_item_id
    left join public.charge_item_definitions d on d.id = ci.definition_id
  ),
  inv_line_tot as (
    select lines.invoice_id, coalesce(sum(lines.net_amount), 0) as lines_sum
    from lines
    group by lines.invoice_id
  ),
  cat_line as (
    select
      l.charge_category,
      l.invoice_id,
      sum(l.net_amount) as cat_amount
    from lines l
    group by l.charge_category, l.invoice_id
  ),
  cat_billed as (
    select c.charge_category, sum(c.cat_amount) as total_billed
    from cat_line c
    group by c.charge_category
  ),
  cat_collected as (
    select
      c.charge_category,
      sum(
        case
          when coalesce(it.lines_sum, 0) = 0 then 0::numeric
          else coalesce(pb.paid, 0) * (c.cat_amount / it.lines_sum)
        end
      ) as total_collected
    from cat_line c
    inner join inv_line_tot it on it.invoice_id = c.invoice_id
    left join pay_by_inv pb on pb.invoice_id = c.invoice_id
    group by c.charge_category
  )
  select
    b.charge_category,
    b.total_billed,
    coalesce(col.total_collected, 0) as total_collected,
    case
      when b.total_billed = 0 then 0::numeric
      else round((coalesce(col.total_collected, 0) / b.total_billed) * 100, 2)
    end as collection_rate
  from cat_billed b
  left join cat_collected col on col.charge_category = b.charge_category
  order by b.charge_category;
end;
$fn$;

comment on function public.get_revenue_by_category(uuid, date, date) is
  'Revenue by charge_item_definitions.category; collected = confirmed payments pro-rata by line net_amount.';

-- ---------------------------------------------------------------------------
-- get_provider_revenue (via invoices.encounter_id → opd_encounters.doctor_id)
-- ---------------------------------------------------------------------------

create or replace function public.get_provider_revenue(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  practitioner_id uuid,
  practitioner_name text,
  total_revenue numeric,
  patient_count bigint,
  invoice_count bigint
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
  with inv as (
    select i.id, i.patient_id, i.total_gross, i.encounter_id
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and (i.invoice_date at time zone 'utc')::date between p_start_date and p_end_date
      and i.status is distinct from 'cancelled'
  ),
  prov as (
    select
      i.id as invoice_id,
      i.patient_id,
      i.total_gross,
      e.doctor_id
    from inv i
    left join public.opd_encounters e on e.id = i.encounter_id
  )
  select
    p.doctor_id as practitioner_id,
    coalesce(
      nullif(trim(max(pr.full_name)), ''),
      'Unassigned'
    )::text as practitioner_name,
    coalesce(sum(p.total_gross), 0) as total_revenue,
    count(distinct p.patient_id)::bigint as patient_count,
    count(*)::bigint as invoice_count
  from prov p
  left join public.practitioners pr on pr.id = p.doctor_id
  group by p.doctor_id
  order by total_revenue desc;
end;
$fn$;

comment on function public.get_provider_revenue(uuid, date, date) is
  'Billed gross by encounter attending doctor (opd_encounters.doctor_id); unassigned when no encounter/doctor.';

-- ---------------------------------------------------------------------------
-- get_collection_efficiency (payment method mix in range)
-- ---------------------------------------------------------------------------

create or replace function public.get_collection_efficiency(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  payment_method text,
  total_collected numeric,
  transaction_count integer,
  share_pct numeric
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
  with base as (
    select
      public._billing_payment_bucket(p.payment_method) as pm,
      p.amount
    from public.payments p
    where p.hospital_id = p_hospital_id
      and p.status = 'confirmed'
      and (p.payment_date at time zone 'utc')::date between p_start_date and p_end_date
  ),
  grand as (
    select coalesce(sum(b.amount), 0) as g from base b
  ),
  agg as (
    select
      b.pm,
      count(*)::integer as txn_cnt,
      coalesce(sum(b.amount), 0) as amt
    from base b
    group by b.pm
  )
  select
    a.pm as payment_method,
    a.amt as total_collected,
    a.txn_cnt as transaction_count,
    case
      when gr.g = 0 then 0::numeric
      else round(100.0 * a.amt / gr.g, 2)
    end as share_pct
  from agg a
  cross join grand gr
  order by a.amt desc;
end;
$fn$;

comment on function public.get_collection_efficiency(uuid, date, date) is
  'Confirmed collections by bucket (cash|upi|card|other) and share_pct of total in UTC date range.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.get_revenue_by_department(uuid, date, date) from public;
revoke all on function public.get_revenue_by_category(uuid, date, date) from public;
revoke all on function public.get_provider_revenue(uuid, date, date) from public;
revoke all on function public.get_collection_efficiency(uuid, date, date) from public;

grant execute on function public.get_revenue_by_department(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_revenue_by_category(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_provider_revenue(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_collection_efficiency(uuid, date, date) to authenticated, service_role;
