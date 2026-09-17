-- billable_procedures view (nursing procedure master) + IPD charge oversight flag + richer unbilled RPC.

-- ---------------------------------------------------------------------------
-- charge_items: doctor/nursing oversight flag for IPD nursing queue
-- ---------------------------------------------------------------------------
alter table public.charge_items
  add column if not exists oversight_status text not null default 'open';

do $chk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'charge_items_oversight_status_chk'
  ) then
    alter table public.charge_items
      add constraint charge_items_oversight_status_chk
      check (oversight_status in ('open', 'flagged'));
  end if;
exception
  when duplicate_object then null;
end
$chk$;

comment on column public.charge_items.oversight_status is
  'IPD nursing charge queue: open = normal; flagged = doctor flagged for nursing review.';

-- ---------------------------------------------------------------------------
-- billable_procedures: nursing procedure master (subset of charge_item_definitions)
-- ---------------------------------------------------------------------------
create or replace view public.billable_procedures as
select
  d.id,
  d.display_name as name,
  d.base_price as default_amount,
  d.code,
  d.hospital_id,
  (d.status = 'active') as is_active
from public.charge_item_definitions d
where d.category = 'nursing_procedure';

grant select on public.billable_procedures to authenticated, service_role;

comment on view public.billable_procedures is
  'Active nursing billable procedures per hospital (charge_item_definitions.category = nursing_procedure).';

-- ---------------------------------------------------------------------------
-- get_unbilled_nursing_charges: include performer, time, oversight
-- ---------------------------------------------------------------------------
create or replace function public.get_unbilled_nursing_charges(p_admission_id uuid)
returns table (
  charge_item_id uuid,
  procedure_name text,
  performed_by_name text,
  performed_at timestamptz,
  quantity numeric,
  unit_price numeric,
  total numeric,
  source text,
  oversight_status text
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

  select a.hospital_id into v_hospital
  from public.ipd_admissions a
  where a.id = p_admission_id;

  if v_hospital is null then
    raise exception 'admission not found';
  end if;

  perform public._billing_assert_hospital_access(v_hospital);

  return query
  select
    ci.id as charge_item_id,
    coalesce(nullif(trim(ci.display_label), ''), cid.display_name, 'Charge')::text as procedure_name,
    case
      when ci.source_type = 'nursing_procedure_log' then coalesce(pr_n.full_name, '—')
      when ci.source_type = 'consumable_usage_log' then coalesce(pr_u.full_name, '—')
      else '—'
    end::text as performed_by_name,
    case
      when ci.source_type = 'nursing_procedure_log' then npl.performed_at
      when ci.source_type = 'consumable_usage_log' then cul.created_at
      else ci.created_at
    end as performed_at,
    coalesce(ci.quantity_value, 1)::numeric as quantity,
    coalesce(ci.unit_price_snapshot, ci.unit_price, 0)::numeric as unit_price,
    coalesce(ci.net_amount, 0)::numeric as total,
    case ci.source_type
      when 'consumable_usage_log' then 'consumable'
      else 'procedure'
    end::text as source,
    coalesce(ci.oversight_status, 'open')::text as oversight_status
  from public.charge_items ci
  inner join public.charge_item_definitions cid on cid.id = ci.definition_id
  left join public.nursing_procedure_logs npl
    on ci.source_type = 'nursing_procedure_log'
    and npl.id = ci.source_id
  left join public.practitioners pr_n on pr_n.id = npl.performed_by
  left join public.consumable_usage_logs cul
    on ci.source_type = 'consumable_usage_log'
    and cul.id = ci.source_id
  left join public.practitioners pr_u on pr_u.id = cul.used_by
  where ci.hospital_id = v_hospital
    and coalesce(ci.is_billed, false) = false
    and ci.source_type in ('nursing_procedure_log', 'consumable_usage_log')
    and (
      exists (
        select 1
        from public.nursing_procedure_logs npl2
        where npl2.id = ci.source_id
          and npl2.admission_id = p_admission_id
      )
      or exists (
        select 1
        from public.consumable_usage_logs cul2
        where cul2.id = ci.source_id
          and cul2.admission_id = p_admission_id
      )
    )
  order by ci.created_at asc;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- flag_ipd_nursing_charge_for_review
-- ---------------------------------------------------------------------------
create or replace function public.flag_ipd_nursing_charge_for_review(p_charge_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ci public.charge_items%rowtype;
begin
  if p_charge_item_id is null then
    raise exception 'p_charge_item_id required';
  end if;

  select * into v_ci
  from public.charge_items
  where id = p_charge_item_id
  for update;

  if not found then
    raise exception 'charge item not found';
  end if;

  perform public._billing_assert_hospital_access(v_ci.hospital_id);

  if v_ci.source_type not in ('nursing_procedure_log', 'consumable_usage_log') then
    raise exception 'not an IPD nursing queue charge';
  end if;

  if coalesce(v_ci.is_billed, false) then
    raise exception 'charge already billed';
  end if;

  update public.charge_items
  set oversight_status = 'flagged'
  where id = p_charge_item_id;
end;
$fn$;

revoke all on function public.flag_ipd_nursing_charge_for_review(uuid) from public;
grant execute on function public.flag_ipd_nursing_charge_for_review(uuid) to authenticated, service_role;

comment on function public.flag_ipd_nursing_charge_for_review(uuid) is
  'Doctor oversight: flag an unbilled IPD nursing charge for nursing review.';
