-- Expiring batch lines from restock history; counts RPC + mark disposed (adjusts stock + audit row).

alter table public.hospital_inventory_restock
  add column if not exists expired_disposed_at timestamptz;

comment on column public.hospital_inventory_restock.expired_disposed_at is
  'Set when batch is marked expired/disposed via mark_expired_stock(); excluded from pharmacy_expiring_stock.';

drop view if exists public.pharmacy_expiring_stock;

create view public.pharmacy_expiring_stock as
select
  r.id,
  hi.hospital_id,
  hi.id as inventory_item_id,
  hi.brand_name,
  hi.generic_name,
  r.batch_number,
  r.expiry_date,
  (r.expiry_date - current_date)::integer as days_left,
  r.quantity
from public.hospital_inventory_restock r
inner join public.hospital_inventory hi on hi.id = r.hospital_inventory_id
where r.expiry_date is not null
  and r.expired_disposed_at is null
  and r.expiry_date >= current_date
  and r.expiry_date <= current_date + 30;

comment on view public.pharmacy_expiring_stock is
  'Batches expiring within 30 days (not yet disposed). days_left vs UTC date.';

alter table public.hospital_inventory_restock enable row level security;

drop policy if exists "hospital_inventory_restock_select_hospital" on public.hospital_inventory_restock;

create policy "hospital_inventory_restock_select_hospital"
on public.hospital_inventory_restock
for select
to authenticated
using (
  exists (
    select 1
    from public.hospital_inventory hi
    where hi.id = hospital_inventory_restock.hospital_inventory_id
      and exists (
        select 1
        from public.practitioners pr
        where pr.hospital_id = hi.hospital_id
          and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      )
  )
);

comment on policy "hospital_inventory_restock_select_hospital" on public.hospital_inventory_restock is
  'Pharmacy staff: read restock rows for inventory in their hospital.';

-- JSON: { "critical": n, "warning": m } — critical ≤7 days, warning 8–30 days.
create or replace function public.get_expiring_stock_counts(p_hospital_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_crit int;
  v_warn int;
begin
  select exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = p_hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'access denied';
  end if;

  select count(*)::int
  into v_crit
  from public.pharmacy_expiring_stock s
  where s.hospital_id = p_hospital_id
    and s.days_left <= 7;

  select count(*)::int
  into v_warn
  from public.pharmacy_expiring_stock s
  where s.hospital_id = p_hospital_id
    and s.days_left >= 8
    and s.days_left <= 30;

  return jsonb_build_object('critical', coalesce(v_crit, 0), 'warning', coalesce(v_warn, 0));
end;
$$;

grant execute on function public.get_expiring_stock_counts(uuid) to authenticated;

-- Remove batch qty from on-hand stock, log expired transaction, hide from expiring view.
create or replace function public.mark_expired_stock(p_restock_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hi uuid;
  v_hospital uuid;
  v_qty int;
  v_batch text;
  v_performed_by uuid;
  v_new_stock int;
begin
  select r.hospital_inventory_id, hi.hospital_id, r.quantity, nullif(trim(coalesce(r.batch_number, '')), '')
  into v_hi, v_hospital, v_qty, v_batch
  from public.hospital_inventory_restock r
  inner join public.hospital_inventory hi on hi.id = r.hospital_inventory_id
  where r.id = p_restock_line_id
    and r.expired_disposed_at is null;

  if v_hi is null then
    raise exception 'restock line not found or already disposed';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = v_hospital
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  ) then
    raise exception 'access denied';
  end if;

  if v_qty is null or v_qty <= 0 then
    raise exception 'invalid quantity on restock line';
  end if;

  select pr.id
  into v_performed_by
  from public.practitioners pr
  where pr.hospital_id = v_hospital
    and (pr.user_id = auth.uid() or pr.id = auth.uid())
  limit 1;

  update public.hospital_inventory hi
  set stock_quantity = greatest(0, coalesce(hi.stock_quantity, 0) - v_qty)
  where hi.id = v_hi
    and hi.hospital_id = v_hospital
  returning hi.stock_quantity into v_new_stock;

  if v_new_stock is null then
    raise exception 'inventory item not found';
  end if;

  update public.hospital_inventory_restock r
  set expired_disposed_at = now()
  where r.id = p_restock_line_id;

  insert into public.stock_transactions (
    hospital_id,
    inventory_item_id,
    transaction_type,
    quantity,
    batch_number,
    supplier_name,
    notes,
    performed_by
  )
  values (
    v_hospital,
    v_hi,
    'expired',
    -v_qty,
    v_batch,
    null,
    'Batch marked expired / disposed (restock line ' || p_restock_line_id::text || ')',
    v_performed_by
  );
end;
$$;

grant execute on function public.mark_expired_stock(uuid) to authenticated;

comment on function public.get_expiring_stock_counts(uuid) is
  'Returns {"critical": ≤7d count, "warning": 8–30d count} for pharmacy_expiring_stock; session hospital access.';

comment on function public.mark_expired_stock(uuid) is
  'Decrements on-hand stock by restock line qty, inserts stock_transactions expired, sets expired_disposed_at.';

grant select on public.pharmacy_expiring_stock to authenticated;
