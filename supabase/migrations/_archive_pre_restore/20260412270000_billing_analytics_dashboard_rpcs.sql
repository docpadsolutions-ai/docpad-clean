-- RPCs for app/billing/components/AnalyticsDashboard.tsx
-- Uses _billing_assert_hospital_access from prior migration.

-- ---------------------------------------------------------------------------
-- get_revenue_breakdown_by_category: billed revenue share by charge category
-- ---------------------------------------------------------------------------

create or replace function public.get_revenue_breakdown_by_category(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  category text,
  revenue numeric,
  percentage numeric
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
    select i.id
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and (i.invoice_date at time zone 'utc')::date between p_start_date and p_end_date
  ),
  lines as (
    select
      coalesce(d.category::text, 'other') as cat,
      li.net_amount
    from public.invoice_line_items li
    inner join inv on inv.id = li.invoice_id
    left join public.charge_items ci on ci.id = li.charge_item_id
    left join public.charge_item_definitions d on d.id = ci.definition_id
  ),
  agg as (
    select l.cat, coalesce(sum(l.net_amount), 0) as rev
    from lines l
    group by l.cat
  ),
  grand as (
    select coalesce(sum(a.rev), 0) as g from agg a
  )
  select
    a.cat as category,
    a.rev as revenue,
    case
      when gr.g = 0 then 0::numeric
      else round(100.0 * a.rev / gr.g, 2)
    end as percentage
  from agg a
  cross join grand gr
  order by a.rev desc;
end;
$fn$;

comment on function public.get_revenue_breakdown_by_category(uuid, date, date) is
  'Line-item net_amount by charge_item_definitions.category; percentage of total billed in range.';

-- ---------------------------------------------------------------------------
-- get_service_utilization: revenue via charge_items.service_id → services
-- ---------------------------------------------------------------------------

create or replace function public.get_service_utilization(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  service_id uuid,
  service_name text,
  usage_count numeric,
  total_revenue numeric,
  avg_price numeric,
  margin_percent numeric
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
    select i.id
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and (i.invoice_date at time zone 'utc')::date between p_start_date and p_end_date
  ),
  lines as (
    select
      ci.service_id as sid,
      coalesce(svc.service_name, ci.display_label, 'Unlinked service')::text as sname,
      li.quantity,
      li.net_amount,
      svc.cost_basis
    from public.invoice_line_items li
    inner join inv on inv.id = li.invoice_id
    inner join public.charge_items ci on ci.id = li.charge_item_id
    left join public.services svc on svc.id = ci.service_id
  ),
  agg as (
    select
      l.sid,
      max(l.sname) as service_name,
      coalesce(sum(l.quantity), 0) as usage_count,
      coalesce(sum(l.net_amount), 0) as total_revenue,
      coalesce(sum(l.quantity * coalesce(l.cost_basis, 0)), 0) as total_cost
    from lines l
    group by l.sid
  )
  select
    a.sid as service_id,
    a.service_name,
    a.usage_count,
    a.total_revenue,
    case
      when a.usage_count = 0 then 0::numeric
      else round(a.total_revenue / a.usage_count, 2)
    end as avg_price,
    case
      when a.total_revenue = 0 then null::numeric
      when a.total_cost = 0 then null::numeric
      else round(100.0 * (a.total_revenue - a.total_cost) / a.total_revenue, 2)
    end as margin_percent
  from agg a
  where a.total_revenue > 0
  order by a.total_revenue desc
  limit 50;
end;
$fn$;

comment on function public.get_service_utilization(uuid, date, date) is
  'Top services by line net_amount; margin from services.cost_basis × quantity when cost present.';

-- ---------------------------------------------------------------------------
-- get_outstanding_by_department: AR buckets by department
-- ---------------------------------------------------------------------------

create or replace function public.get_outstanding_by_department(p_hospital_id uuid)
returns table (
  department_id uuid,
  department_name text,
  outstanding_0_30 numeric,
  outstanding_31_60 numeric,
  outstanding_61_90 numeric,
  outstanding_90_plus numeric,
  total_outstanding numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  with open_inv as (
    select
      i.department_id,
      i.balance_due,
      greatest(
        0,
        (current_date - coalesce(i.due_date, (i.invoice_date at time zone 'utc')::date))::integer
      ) as age_days
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and i.balance_due > 0
      and i.status is distinct from 'cancelled'
  ),
  bucketed as (
    select
      o.department_id,
      o.balance_due,
      case
        when o.age_days <= 30 then o.balance_due
        else 0::numeric
      end as b0_30,
      case
        when o.age_days between 31 and 60 then o.balance_due
        else 0::numeric
      end as b31_60,
      case
        when o.age_days between 61 and 90 then o.balance_due
        else 0::numeric
      end as b61_90,
      case
        when o.age_days > 90 then o.balance_due
        else 0::numeric
      end as b90p
    from open_inv o
  )
  select
    b.department_id,
    coalesce(dep.name, 'Unassigned')::text as department_name,
    coalesce(sum(b.b0_30), 0) as outstanding_0_30,
    coalesce(sum(b.b31_60), 0) as outstanding_31_60,
    coalesce(sum(b.b61_90), 0) as outstanding_61_90,
    coalesce(sum(b.b90p), 0) as outstanding_90_plus,
    coalesce(sum(b.balance_due), 0) as total_outstanding
  from bucketed b
  left join public.departments dep on dep.id = b.department_id
  group by b.department_id, dep.name
  order by total_outstanding desc;
end;
$fn$;

comment on function public.get_outstanding_by_department(uuid) is
  'Open balance_due by invoice.department_id; age = current_date - coalesce(due_date, invoice_date UTC).';

-- ---------------------------------------------------------------------------
-- get_top_defaulters
-- ---------------------------------------------------------------------------

create or replace function public.get_top_defaulters(
  p_hospital_id uuid,
  p_limit integer default 10
)
returns table (
  patient_id uuid,
  patient_name text,
  total_outstanding numeric,
  invoice_count bigint,
  oldest_invoice_date date
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lim integer := greatest(1, least(coalesce(p_limit, 10), 100));
begin
  perform public._billing_assert_hospital_access(p_hospital_id);

  return query
  select
    i.patient_id,
    coalesce(nullif(trim(pt.full_name), ''), '—')::text as patient_name,
    coalesce(sum(i.balance_due), 0) as total_outstanding,
    count(*)::bigint as invoice_count,
    min((i.invoice_date at time zone 'utc')::date) as oldest_invoice_date
  from public.invoices i
  inner join public.patients pt on pt.id = i.patient_id
  where i.hospital_id = p_hospital_id
    and i.balance_due > 0
    and i.status is distinct from 'cancelled'
  group by i.patient_id, pt.full_name
  order by total_outstanding desc
  limit v_lim;
end;
$fn$;

comment on function public.get_top_defaulters(uuid, integer) is
  'Patients with largest total open balance_due for the hospital.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.get_revenue_breakdown_by_category(uuid, date, date) from public;
revoke all on function public.get_service_utilization(uuid, date, date) from public;
revoke all on function public.get_outstanding_by_department(uuid) from public;
revoke all on function public.get_top_defaulters(uuid, integer) from public;

grant execute on function public.get_revenue_breakdown_by_category(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_service_utilization(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_outstanding_by_department(uuid) to authenticated, service_role;
grant execute on function public.get_top_defaulters(uuid, integer) to authenticated, service_role;
