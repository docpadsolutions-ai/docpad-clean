-- Billing analytics RPCs (SECURITY DEFINER).
-- Hospital scope: practitioners.hospital_id where practitioners.user_id = auth.uid().
--
-- Aligned to production schema (hvjbzlwlqnntwxgufjkm): invoices / payments / invoice_line_items
-- already exist; line items link charge_items via charge_item_id → definition_id → charge_item_definitions.

-- ---------------------------------------------------------------------------
-- Bucket payment_method (DB allows cash|upi|card|netbanking|cheque|insurance|other → 4 reporting buckets)
-- ---------------------------------------------------------------------------

create or replace function public._billing_payment_bucket(p_method text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_method, '') = 'cash' then 'cash'
    when p_method = 'upi' then 'upi'
    when p_method = 'card' then 'card'
    else 'other'
  end;
$$;

comment on function public._billing_payment_bucket(text) is
  'Internal: map payments.payment_method to cash|upi|card|other for analytics.';

revoke all on function public._billing_payment_bucket(text) from public;
grant execute on function public._billing_payment_bucket(text) to service_role;

-- PL/pgSQL bodies use $fn$ so migration runners that wrap SQL in $$ do not break.

-- ---------------------------------------------------------------------------
-- 1. get_daily_collection_summary
-- ---------------------------------------------------------------------------

create or replace function public.get_daily_collection_summary(p_date date default (current_date))
returns table (
  payment_method text,
  transaction_count integer,
  total_amount numeric,
  voided_count integer,
  voided_amount numeric,
  net_collected numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  select pr.hospital_id
  into v_hospital
  from public.practitioners pr
  where pr.user_id = auth.uid()
  limit 1;

  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  with base as (
    select
      public._billing_payment_bucket(p.payment_method) as pm,
      p.amount,
      p.status
    from public.payments p
    where p.hospital_id = v_hospital
      and (p.payment_date at time zone 'utc')::date = p_date
  ),
  agg as (
    select
      b.pm,
      count(*) filter (where b.status = 'confirmed')::integer as txn_cnt,
      coalesce(sum(b.amount) filter (where b.status = 'confirmed'), 0) as confirmed_amt,
      count(*) filter (where b.status = 'voided')::integer as v_cnt,
      coalesce(sum(b.amount) filter (where b.status = 'voided'), 0) as v_amt
    from base b
    group by b.pm
  )
  select
    a.pm as payment_method,
    a.txn_cnt as transaction_count,
    (a.confirmed_amt + a.v_amt) as total_amount,
    a.v_cnt as voided_count,
    a.v_amt as voided_amount,
    a.confirmed_amt as net_collected
  from agg a
  order by a.pm;
end;
$fn$;

comment on function public.get_daily_collection_summary(date) is
  'Per bucket totals for a UTC calendar day; total_amount = confirmed + voided; net_collected = confirmed only (= total_amount - voided_amount).';

-- ---------------------------------------------------------------------------
-- 2. get_collection_report
-- ---------------------------------------------------------------------------

create or replace function public.get_collection_report(p_from date, p_to date)
returns table (
  report_date date,
  cash_total numeric,
  upi_total numeric,
  card_total numeric,
  other_total numeric,
  total_collected numeric,
  invoice_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_from > p_to then
    raise exception 'p_from must be <= p_to';
  end if;

  select pr.hospital_id
  into v_hospital
  from public.practitioners pr
  where pr.user_id = auth.uid()
  limit 1;

  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as report_date
  ),
  pay as (
    select
      (p.payment_date at time zone 'utc')::date as d,
      public._billing_payment_bucket(p.payment_method) as pm,
      p.amount,
      p.invoice_id
    from public.payments p
    where p.hospital_id = v_hospital
      and p.status = 'confirmed'
      and (p.payment_date at time zone 'utc')::date between p_from and p_to
  ),
  agg as (
    select
      pay.d,
      coalesce(sum(pay.amount) filter (where pay.pm = 'cash'), 0) as cash_total,
      coalesce(sum(pay.amount) filter (where pay.pm = 'upi'), 0) as upi_total,
      coalesce(sum(pay.amount) filter (where pay.pm = 'card'), 0) as card_total,
      coalesce(sum(pay.amount) filter (where pay.pm = 'other'), 0) as other_total,
      coalesce(sum(pay.amount), 0) as total_collected,
      count(distinct pay.invoice_id) filter (where pay.invoice_id is not null) as invoice_count
    from pay
    group by pay.d
  )
  select
    days.report_date,
    coalesce(a.cash_total, 0) as cash_total,
    coalesce(a.upi_total, 0) as upi_total,
    coalesce(a.card_total, 0) as card_total,
    coalesce(a.other_total, 0) as other_total,
    coalesce(a.total_collected, 0) as total_collected,
    coalesce(a.invoice_count, 0)::bigint as invoice_count
  from days
  left join agg a on a.d = days.report_date
  order by days.report_date;
end;
$fn$;

comment on function public.get_collection_report(date, date) is
  'Daily net collected by bucket (confirmed payments); invoice_count = distinct invoices paid that day.';

-- ---------------------------------------------------------------------------
-- 3. get_outstanding_invoices
-- ---------------------------------------------------------------------------

create or replace function public.get_outstanding_invoices(p_limit integer default 50)
returns table (
  invoice_id uuid,
  invoice_number text,
  patient_id uuid,
  patient_full_name text,
  total_gross numeric,
  amount_paid numeric,
  balance_due numeric,
  status text,
  invoice_date date,
  due_date date,
  days_overdue integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  select pr.hospital_id
  into v_hospital
  from public.practitioners pr
  where pr.user_id = auth.uid()
  limit 1;

  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  select
    i.id as invoice_id,
    i.invoice_number,
    i.patient_id,
    coalesce(pt.full_name, '')::text as patient_full_name,
    i.total_gross,
    i.amount_paid,
    i.balance_due,
    i.status,
    (i.invoice_date at time zone 'utc')::date as invoice_date,
    (i.due_date at time zone 'utc')::date as due_date,
    case
      when i.due_date is null then null::integer
      else (current_date - (i.due_date at time zone 'utc')::date)::integer
    end as days_overdue
  from public.invoices i
  inner join public.patients pt on pt.id = i.patient_id
  where i.hospital_id = v_hospital
    and i.balance_due > 0
    and i.status is distinct from 'cancelled'
  order by i.due_date asc nulls last, i.invoice_date asc
  limit v_limit;
end;
$fn$;

comment on function public.get_outstanding_invoices(integer) is
  'Open balances for hospital; days_overdue from current_date - due_date (UTC date).';

-- ---------------------------------------------------------------------------
-- 4. get_revenue_by_charge_type
-- ---------------------------------------------------------------------------

create or replace function public.get_revenue_by_charge_type(p_from date, p_to date)
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
declare
  v_hospital uuid;
begin
  if p_from > p_to then
    raise exception 'p_from must be <= p_to';
  end if;

  select pr.hospital_id
  into v_hospital
  from public.practitioners pr
  where pr.user_id = auth.uid()
  limit 1;

  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  with inv as (
    select i.id, i.total_gross
    from public.invoices i
    where i.hospital_id = v_hospital
      and (i.invoice_date at time zone 'utc')::date between p_from and p_to
  ),
  pay_by_inv as (
    select p.invoice_id, coalesce(sum(p.amount) filter (where p.status = 'confirmed'), 0) as paid
    from public.payments p
    where p.hospital_id = v_hospital
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
          when coalesce(it.lines_sum, 0) = 0 then 0
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

comment on function public.get_revenue_by_charge_type(date, date) is
  'Revenue by charge_item_definitions.category via charge_items.definition_id; collected = confirmed payments pro-rata by line net_amount.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.get_daily_collection_summary(date) from public;
revoke all on function public.get_collection_report(date, date) from public;
revoke all on function public.get_outstanding_invoices(integer) from public;
revoke all on function public.get_revenue_by_charge_type(date, date) from public;

grant execute on function public.get_daily_collection_summary(date) to authenticated, service_role;
grant execute on function public.get_collection_report(date, date) to authenticated, service_role;
grant execute on function public.get_outstanding_invoices(integer) to authenticated, service_role;
grant execute on function public.get_revenue_by_charge_type(date, date) to authenticated, service_role;
