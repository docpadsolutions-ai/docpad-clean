-- Ward consumables inventory + usage logs + RPCs (NABH MOM.11 low-stock awareness).

-- ---------------------------------------------------------------------------
-- ward_inventory
-- ---------------------------------------------------------------------------
create table if not exists public.ward_inventory (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.ipd_wards (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  item_name text not null,
  category text,
  current_stock numeric not null default 0 check (current_stock >= 0),
  minimum_stock numeric not null default 0 check (minimum_stock >= 0),
  last_restocked_at timestamptz,
  last_restocked_by uuid references public.practitioners (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ward_inventory_ward_idx on public.ward_inventory (ward_id);
create index if not exists ward_inventory_hospital_idx on public.ward_inventory (hospital_id);

comment on table public.ward_inventory is
  'Per-ward consumables stock; low-stock when current_stock <= minimum_stock (NABH MOM.11).';

-- ---------------------------------------------------------------------------
-- consumable_usage_logs
-- ---------------------------------------------------------------------------
create table if not exists public.consumable_usage_logs (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  ward_inventory_id uuid not null references public.ward_inventory (id) on delete cascade,
  admission_id uuid references public.ipd_admissions (id) on delete set null,
  patient_id uuid references public.patients (id) on delete set null,
  quantity numeric not null check (quantity > 0),
  notes text,
  used_at timestamptz not null default timezone('utc', now()),
  used_by uuid references public.practitioners (id) on delete set null,
  billing_charge_stub text
);

create index if not exists consumable_usage_logs_ward_inv_idx
  on public.consumable_usage_logs (ward_inventory_id, used_at desc);

-- ---------------------------------------------------------------------------
-- get_ward_inventory(p_ward_id)
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
  last_restocked_by_name text
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
    pr.full_name as last_restocked_by_name
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
-- use_consumable(...)
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
as $$
declare
  v_me uuid := public._nursing_tasks_current_practitioner_id();
  v_wi public.ward_inventory%rowtype;
  v_charge_ref text;
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
  );

  return jsonb_build_object(
    'success', true,
    'billing_charge_ref', v_charge_ref
  );
end;
$$;

grant execute on function public.use_consumable(uuid, numeric, uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- restock_ward_item(...)
-- ---------------------------------------------------------------------------
create or replace function public.restock_ward_item(
  p_ward_inventory_id uuid,
  p_add_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public._nursing_tasks_current_practitioner_id();
  v_wi public.ward_inventory%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated as practitioner';
  end if;

  if p_add_quantity is null or p_add_quantity <= 0 then
    raise exception 'Add quantity must be positive';
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

  update public.ward_inventory wi
  set
    current_stock = wi.current_stock + p_add_quantity,
    last_restocked_at = timezone('utc', now()),
    last_restocked_by = v_me,
    updated_at = timezone('utc', now())
  where wi.id = p_ward_inventory_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.restock_ward_item(uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ward_inventory enable row level security;
alter table public.consumable_usage_logs enable row level security;

drop policy if exists ward_inventory_staff on public.ward_inventory;
create policy ward_inventory_staff
  on public.ward_inventory
  for all
  to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ward_inventory.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ward_inventory.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists consumable_usage_logs_staff on public.consumable_usage_logs;
create policy consumable_usage_logs_staff
  on public.consumable_usage_logs
  for all
  to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = consumable_usage_logs.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = consumable_usage_logs.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.ward_inventory to authenticated, service_role;
grant select, insert, update, delete on public.consumable_usage_logs to authenticated, service_role;
