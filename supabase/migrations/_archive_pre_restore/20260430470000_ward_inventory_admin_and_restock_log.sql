-- Ward inventory admin columns, restock audit log, extended get_ward_inventory, restock_ward_item(practitioner + note).

-- ---------------------------------------------------------------------------
-- charge_item_definitions: consumable + equipment categories
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
      'consumable',
      'equipment',
      'room_charge',
      'nursing',
      'nursing_procedure',
      'registration',
      'other'
    )
  );

-- ---------------------------------------------------------------------------
-- ward_inventory: admin / billing fields
-- ---------------------------------------------------------------------------
alter table public.ward_inventory
  add column if not exists unit text;

alter table public.ward_inventory
  add column if not exists unit_cost numeric(14, 2) not null default 0;

alter table public.ward_inventory
  add column if not exists charge_item_def_id uuid references public.charge_item_definitions (id) on delete set null;

alter table public.ward_inventory
  add column if not exists is_billable boolean not null default true;

comment on column public.ward_inventory.unit is 'Display unit (e.g. piece, box).';
comment on column public.ward_inventory.unit_cost is 'Internal unit cost for admin reporting.';
comment on column public.ward_inventory.charge_item_def_id is 'Optional billing definition when usage creates a charge.';
comment on column public.ward_inventory.is_billable is 'When true, usage may create patient charges when configured.';

-- ---------------------------------------------------------------------------
-- ward_stock_restock_log
-- ---------------------------------------------------------------------------
create table if not exists public.ward_stock_restock_log (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  ward_inventory_id uuid not null references public.ward_inventory (id) on delete cascade,
  quantity_added numeric not null check (quantity_added > 0),
  source_note text,
  restocked_by uuid references public.practitioners (id) on delete set null,
  restocked_at timestamptz not null default timezone('utc', now())
);

create index if not exists ward_stock_restock_log_ward_inv_idx
  on public.ward_stock_restock_log (ward_inventory_id, restocked_at desc);

alter table public.ward_stock_restock_log enable row level security;

drop policy if exists ward_stock_restock_log_staff on public.ward_stock_restock_log;
create policy ward_stock_restock_log_staff
  on public.ward_stock_restock_log
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.practitioners pr
      where pr.hospital_id = ward_stock_restock_log.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from public.practitioners pr
      where pr.hospital_id = ward_stock_restock_log.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.ward_stock_restock_log to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_ward_inventory: extended columns (backward-compatible for callers that ignore extras)
-- ---------------------------------------------------------------------------
create or replace function public.get_ward_inventory(p_ward_id uuid)
returns table (
  ward_inventory_id uuid,
  item_name text,
  category text,
  current_stock numeric,
  minimum_stock numeric,
  is_low_stock boolean,
  last_restocked_at timestamptz,
  last_restocked_by_name text,
  unit text,
  unit_cost numeric,
  charge_item_def_id uuid,
  is_billable boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    wi.id as ward_inventory_id,
    wi.item_name,
    coalesce(wi.category, 'General') as category,
    wi.current_stock,
    wi.minimum_stock,
    (wi.current_stock <= wi.minimum_stock) as is_low_stock,
    wi.last_restocked_at,
    pr.full_name as last_restocked_by_name,
    wi.unit,
    wi.unit_cost,
    wi.charge_item_def_id,
    wi.is_billable
  from public.ward_inventory wi
  left join public.practitioners pr on pr.id = wi.last_restocked_by
  where wi.ward_id = p_ward_id
    and exists (
      select 1
      from public.practitioners me
      where me.hospital_id = wi.hospital_id
        and (me.user_id = (select auth.uid()) or me.id = (select auth.uid()))
    )
  order by wi.item_name;
$$;

grant execute on function public.get_ward_inventory(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- restock_ward_item (4-arg; replaces 2-arg)
-- ---------------------------------------------------------------------------
drop function if exists public.restock_ward_item(uuid, numeric);

create or replace function public.restock_ward_item(
  p_ward_inventory_id uuid,
  p_add_quantity numeric,
  p_practitioner_id uuid,
  p_source_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_wi public.ward_inventory%rowtype;
begin
  if p_ward_inventory_id is null then
    raise exception 'p_ward_inventory_id required';
  end if;

  if p_add_quantity is null or p_add_quantity <= 0 then
    raise exception 'Add quantity must be positive';
  end if;

  if p_practitioner_id is null then
    raise exception 'p_practitioner_id required';
  end if;

  select * into v_wi
  from public.ward_inventory wi
  where wi.id = p_ward_inventory_id
  for update;

  if not found then
    raise exception 'Ward inventory item not found';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.id = p_practitioner_id
      and pr.hospital_id = v_wi.hospital_id
  ) then
    raise exception 'Practitioner not allowed for this ward inventory';
  end if;

  if not exists (
    select 1
    from public.practitioners me
    where me.id = p_practitioner_id
      and (me.user_id = (select auth.uid()) or me.id = (select auth.uid()))
  ) then
    raise exception 'Not authenticated as this practitioner';
  end if;

  insert into public.ward_stock_restock_log (
    hospital_id,
    ward_inventory_id,
    quantity_added,
    source_note,
    restocked_by,
    restocked_at
  ) values (
    v_wi.hospital_id,
    p_ward_inventory_id,
    p_add_quantity,
    nullif(trim(coalesce(p_source_note, '')), ''),
    p_practitioner_id,
    timezone('utc', now())
  );

  update public.ward_inventory wi
  set
    current_stock = wi.current_stock + p_add_quantity,
    last_restocked_at = timezone('utc', now()),
    last_restocked_by = p_practitioner_id,
    updated_at = timezone('utc', now())
  where wi.id = p_ward_inventory_id;

  return jsonb_build_object('success', true);
end;
$fn$;

grant execute on function public.restock_ward_item(uuid, numeric, uuid, text) to authenticated, service_role;

comment on function public.restock_ward_item(uuid, numeric, uuid, text) is
  'Adds stock to ward_inventory and appends ward_stock_restock_log.';
