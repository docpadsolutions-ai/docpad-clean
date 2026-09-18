-- IPD nursing procedure logging + unbilled nursing charges (procedures + ward consumables).

-- ---------------------------------------------------------------------------
-- charge_item_definitions: allow nursing_procedure category
-- ---------------------------------------------------------------------------
alter table public.charge_item_definitions drop constraint if exists charge_item_definitions_category_check;
alter table public.charge_item_definitions drop constraint if exists charge_item_definitions_category_chk;

alter table public.charge_item_definitions
  add constraint charge_item_definitions_category_chk
  check (
    category in (
      'consultation',
      'procedure',
      'lab_test',
      'imaging',
      'medication',
      'supply',
      'room_charge',
      'nursing',
      'nursing_procedure',
      'registration',
      'other'
    )
  );

-- ---------------------------------------------------------------------------
-- charge_items: billing flag for IPD nursing queue
-- ---------------------------------------------------------------------------
alter table public.charge_items
  add column if not exists is_billed boolean not null default false;

comment on column public.charge_items.is_billed is
  'When true, this charge row has been placed on an invoice line (IPD nursing / consumables queue).';

-- ---------------------------------------------------------------------------
-- invoices: link optional IPD draft to admission
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists ipd_admission_id uuid references public.ipd_admissions (id) on delete set null;

create index if not exists invoices_ipd_admission_draft_idx
  on public.invoices (hospital_id, patient_id, ipd_admission_id)
  where ipd_admission_id is not null and coalesce(status, '') = 'draft';

-- ---------------------------------------------------------------------------
-- consumable_usage_logs: link generated charge row
-- ---------------------------------------------------------------------------
alter table public.consumable_usage_logs
  add column if not exists charge_item_id uuid references public.charge_items (id) on delete set null;

-- ---------------------------------------------------------------------------
-- nursing_procedure_logs
-- ---------------------------------------------------------------------------
create table if not exists public.nursing_procedure_logs (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  nursing_task_id uuid references public.nursing_tasks (id) on delete set null,
  procedure_name text not null,
  procedure_code text not null,
  performed_at timestamptz not null default timezone('utc', now()),
  performed_by uuid references public.practitioners (id) on delete set null,
  charge_item_def_id uuid not null references public.charge_item_definitions (id) on delete restrict,
  notes text,
  charge_item_id uuid references public.charge_items (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists nursing_procedure_logs_admission_idx
  on public.nursing_procedure_logs (admission_id, performed_at desc);

alter table public.nursing_procedure_logs enable row level security;

drop policy if exists nursing_procedure_logs_staff_all on public.nursing_procedure_logs;
create policy nursing_procedure_logs_staff_all
  on public.nursing_procedure_logs
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.practitioners pr
      where pr.hospital_id = nursing_procedure_logs.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from public.practitioners pr
      where pr.hospital_id = nursing_procedure_logs.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.nursing_procedure_logs to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- AFTER INSERT: create charge_items for nursing_procedure_logs
-- ---------------------------------------------------------------------------
create or replace function public.trg_fn_nursing_procedure_log_create_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_def public.charge_item_definitions%rowtype;
  v_price numeric(14, 2);
  v_net numeric(14, 2);
  v_qty numeric(14, 4) := 1;
  v_ci uuid;
begin
  select * into v_def
  from public.charge_item_definitions
  where id = new.charge_item_def_id;

  if not found then
    raise exception 'charge_item_def_id not found';
  end if;

  v_price := coalesce(v_def.base_price, 0);
  v_net := round(v_qty * v_price, 2);

  insert into public.charge_items (
    hospital_id,
    patient_id,
    definition_id,
    category,
    display_label,
    charge_code,
    charge_code_system,
    charge_code_display,
    source_type,
    source_id,
    requesting_practitioner_id,
    quantity_value,
    unit_price,
    unit_price_snapshot,
    net_amount,
    currency,
    status,
    is_billed,
    override_reason
  ) values (
    new.hospital_id,
    new.patient_id,
    new.charge_item_def_id,
    v_def.category,
    coalesce(nullif(trim(new.procedure_name), ''), v_def.display_name),
    v_def.code,
    v_def.code_system,
    v_def.display_name,
    'nursing_procedure_log',
    new.id,
    new.performed_by,
    v_qty,
    v_price,
    v_price,
    v_net,
    coalesce(v_def.currency, 'INR'),
    case when v_price > 0 then 'billable' else 'planned' end,
    false,
    case when v_price <= 0 then 'UNPRICED: awaiting manual price entry' else null end
  )
  returning id into v_ci;

  update public.nursing_procedure_logs
  set charge_item_id = v_ci
  where id = new.id;

  return new;
end;
$fn$;

drop trigger if exists trg_nursing_procedure_log_create_charge on public.nursing_procedure_logs;
create trigger trg_nursing_procedure_log_create_charge
  after insert on public.nursing_procedure_logs
  for each row
  execute function public.trg_fn_nursing_procedure_log_create_charge();

-- ---------------------------------------------------------------------------
-- use_consumable: also create charge_items (supply) when a definition exists
-- ---------------------------------------------------------------------------
create or replace function public.use_consumable(
  p_ward_inventory_id uuid,
  p_quantity numeric,
  p_admission_id uuid,
  p_patient_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public._nursing_tasks_current_practitioner_id();
  v_wi public.ward_inventory%rowtype;
  v_charge_ref text;
  v_log_id uuid;
  v_item_name text;
  v_def_id uuid;
  v_price numeric(14, 2);
  v_net numeric(14, 2);
  v_ci uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated as practitioner';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  select * into v_wi
  from public.ward_inventory wi
  where wi.id = p_ward_inventory_id
  for update;

  if not found then
    raise exception 'Ward inventory item not found';
  end if;

  if not exists (
    select 1 from public.practitioners pr
    where pr.id = v_me and pr.hospital_id = v_wi.hospital_id
  ) then
    raise exception 'Not allowed';
  end if;

  if v_wi.current_stock < p_quantity then
    raise exception 'Insufficient stock';
  end if;

  update public.ward_inventory wi
  set
    current_stock = wi.current_stock - p_quantity,
    updated_at = timezone('utc', now())
  where wi.id = p_ward_inventory_id;

  v_charge_ref := 'auto:' || gen_random_uuid()::text;

  insert into public.consumable_usage_logs (
    hospital_id,
    ward_inventory_id,
    admission_id,
    patient_id,
    quantity,
    notes,
    used_by,
    billing_charge_stub
  ) values (
    v_wi.hospital_id,
    p_ward_inventory_id,
    p_admission_id,
    p_patient_id,
    p_quantity,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_me,
    v_charge_ref
  )
  returning id into v_log_id;

  v_item_name := v_wi.item_name;

  select d.id, d.base_price
  into v_def_id, v_price
  from public.charge_item_definitions d
  where d.hospital_id = v_wi.hospital_id
    and d.category = 'supply'
    and d.status = 'active'
    and d.display_name ilike '%' || v_item_name || '%'
  order by length(d.display_name) asc
  limit 1;

  if v_def_id is null then
    select d.id, d.base_price
    into v_def_id, v_price
    from public.charge_item_definitions d
    where d.hospital_id = v_wi.hospital_id
      and d.category = 'supply'
      and d.status = 'active'
    order by d.updated_at desc nulls last
    limit 1;
  end if;

  if v_def_id is not null and coalesce(v_price, 0) > 0 then
    v_net := round(p_quantity * v_price, 2);

    insert into public.charge_items (
      hospital_id,
      patient_id,
      definition_id,
      category,
      display_label,
      charge_code,
      charge_code_system,
      charge_code_display,
      source_type,
      source_id,
      requesting_practitioner_id,
      quantity_value,
      unit_price,
      unit_price_snapshot,
      net_amount,
      currency,
      status,
      is_billed,
      override_reason
    )
    select
      v_wi.hospital_id,
      p_patient_id,
      v_def_id,
      d.category,
      coalesce(v_item_name, d.display_name),
      d.code,
      d.code_system,
      d.display_name,
      'consumable_usage_log',
      v_log_id,
      v_me,
      p_quantity,
      v_price,
      v_price,
      v_net,
      coalesce(d.currency, 'INR'),
      'billable',
      false,
      null
    from public.charge_item_definitions d
    where d.id = v_def_id
    returning id into v_ci;

    update public.consumable_usage_logs
    set charge_item_id = v_ci
    where id = v_log_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'billing_charge_ref', v_charge_ref,
    'charge_item_id', v_ci
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- get_unbilled_nursing_charges(p_admission_id)
-- ---------------------------------------------------------------------------
create or replace function public.get_unbilled_nursing_charges(p_admission_id uuid)
returns table (
  charge_item_id uuid,
  description text,
  quantity numeric,
  unit_price numeric,
  total numeric,
  source text
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
    coalesce(nullif(trim(ci.display_label), ''), cid.display_name, 'Charge')::text as description,
    coalesce(ci.quantity_value, 1)::numeric as quantity,
    coalesce(ci.unit_price_snapshot, ci.unit_price, 0)::numeric as unit_price,
    coalesce(ci.net_amount, 0)::numeric as total,
    case ci.source_type
      when 'consumable_usage_log' then 'consumable'
      else 'procedure'
    end::text as source
  from public.charge_items ci
  inner join public.charge_item_definitions cid on cid.id = ci.definition_id
  where ci.hospital_id = v_hospital
    and coalesce(ci.is_billed, false) = false
    and ci.source_type in ('nursing_procedure_log', 'consumable_usage_log')
    and (
      exists (
        select 1
        from public.nursing_procedure_logs npl
        where npl.id = ci.source_id
          and npl.admission_id = p_admission_id
      )
      or exists (
        select 1
        from public.consumable_usage_logs cul
        where cul.id = ci.source_id
          and cul.admission_id = p_admission_id
      )
    )
  order by ci.created_at asc;
end;
$fn$;

revoke all on function public.get_unbilled_nursing_charges(uuid) from public;
grant execute on function public.get_unbilled_nursing_charges(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_or_create_ipd_draft_invoice(p_admission_id)
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_ipd_draft_invoice(p_admission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_adm public.ipd_admissions%rowtype;
  v_inv uuid;
begin
  if p_admission_id is null then
    raise exception 'p_admission_id required';
  end if;

  select * into v_adm from public.ipd_admissions where id = p_admission_id;
  if not found then
    raise exception 'admission not found';
  end if;

  perform public._billing_assert_hospital_access(v_adm.hospital_id);

  select i.id into v_inv
  from public.invoices i
  where i.hospital_id = v_adm.hospital_id
    and i.patient_id = v_adm.patient_id
    and i.ipd_admission_id = p_admission_id
    and coalesce(i.status, '') = 'draft'
  order by i.created_at desc nulls last
  limit 1;

  if v_inv is not null then
    return v_inv;
  end if;

  insert into public.invoices (
    hospital_id,
    patient_id,
    ipd_admission_id,
    status,
    notes
  ) values (
    v_adm.hospital_id,
    v_adm.patient_id,
    p_admission_id,
    'draft',
    'IPD billing draft'
  )
  returning id into v_inv;

  return v_inv;
end;
$fn$;

revoke all on function public.get_or_create_ipd_draft_invoice(uuid) from public;
grant execute on function public.get_or_create_ipd_draft_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- add_unbilled_nursing_charge_to_invoice(p_charge_item_id, p_invoice_id)
-- ---------------------------------------------------------------------------
create or replace function public.add_unbilled_nursing_charge_to_invoice(
  p_charge_item_id uuid,
  p_invoice_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inv public.invoices%rowtype;
  v_ci public.charge_items%rowtype;
  v_next_line integer;
  v_qty numeric(14, 4);
  v_unit numeric(14, 2);
  v_sub numeric(14, 2);
  v_net numeric(14, 2);
begin
  if p_charge_item_id is null or p_invoice_id is null then
    raise exception 'p_charge_item_id and p_invoice_id required';
  end if;

  select * into v_ci
  from public.charge_items
  where id = p_charge_item_id
  for update;

  if not found then
    raise exception 'charge item not found';
  end if;

  if coalesce(v_ci.is_billed, false) then
    raise exception 'charge already billed';
  end if;

  if v_ci.source_type not in ('nursing_procedure_log', 'consumable_usage_log') then
    raise exception 'not an IPD nursing queue charge';
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  perform public._billing_assert_hospital_access(v_inv.hospital_id);

  if v_inv.hospital_id is distinct from v_ci.hospital_id then
    raise exception 'hospital mismatch';
  end if;

  if v_inv.patient_id is distinct from v_ci.patient_id then
    raise exception 'patient mismatch';
  end if;

  if coalesce(v_inv.status, '') <> 'draft' then
    raise exception 'invoice must be draft';
  end if;

  if exists (
    select 1
    from public.invoice_line_items li
    where li.charge_item_id = p_charge_item_id
      and li.voided_at is null
  ) then
    raise exception 'charge already on an invoice line';
  end if;

  select coalesce(max(li.line_number), 0) + 1
  into v_next_line
  from public.invoice_line_items li
  where li.invoice_id = p_invoice_id;

  v_qty := coalesce(v_ci.quantity_value, 1);
  v_unit := coalesce(v_ci.unit_price_snapshot, v_ci.unit_price, 0);
  v_sub := round(v_qty * v_unit * (1 - coalesce(0, 0) / 100.0), 2);
  v_net := coalesce(v_ci.net_amount, v_sub);

  insert into public.invoice_line_items (
    invoice_id,
    charge_item_id,
    line_number,
    quantity,
    unit_price,
    discount_percent,
    tax_percent,
    line_subtotal,
    net_amount
  ) values (
    p_invoice_id,
    p_charge_item_id,
    v_next_line,
    v_qty,
    v_unit,
    0,
    0,
    v_sub,
    v_net
  );

  update public.charge_items
  set is_billed = true
  where id = p_charge_item_id;

  perform public._recalculate_invoice_totals(p_invoice_id);
end;
$fn$;

revoke all on function public.add_unbilled_nursing_charge_to_invoice(uuid, uuid) from public;
grant execute on function public.add_unbilled_nursing_charge_to_invoice(uuid, uuid) to authenticated, service_role;

comment on function public.get_unbilled_nursing_charges(uuid) is
  'IPD: consumable + nursing procedure charge rows not yet attached to an invoice.';

comment on function public.get_or_create_ipd_draft_invoice(uuid) is
  'Returns a draft invoice for this admission (creates one IPD draft if missing).';

comment on function public.add_unbilled_nursing_charge_to_invoice(uuid, uuid) is
  'Adds a queued nursing charge to a draft invoice and marks the charge billed.';
