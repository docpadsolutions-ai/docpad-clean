-- Unified pharmacy stock audit trail (NABH / reconciliation).
create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  inventory_item_id uuid not null references public.hospital_inventory (id) on delete restrict,
  transaction_type text not null
    check (transaction_type in ('restock', 'dispense', 'return', 'adjustment', 'expired')),
  quantity integer not null,
  batch_number text,
  supplier_name text,
  notes text,
  performed_by uuid references public.practitioners (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_transactions_hospital_created_idx
  on public.stock_transactions (hospital_id, created_at desc);

create index if not exists stock_transactions_inventory_idx
  on public.stock_transactions (inventory_item_id);

comment on table public.stock_transactions is
  'Pharmacy stock movements: restock, dispense, return, adjustment, expired; join hospital_inventory + practitioners for reports.';

alter table public.stock_transactions enable row level security;

drop policy if exists "stock_transactions_select_practitioner_hospital" on public.stock_transactions;

create policy "stock_transactions_select_practitioner_hospital"
on public.stock_transactions
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = stock_transactions.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

comment on policy "stock_transactions_select_practitioner_hospital" on public.stock_transactions is
  'Read audit rows for the same hospital as the session practitioner.';

-- Log restocks into stock_transactions (signed quantity positive).
create or replace function public.restock_medication(
  p_hospital_inventory_id uuid,
  p_batch_number text,
  p_expiry_date date,
  p_quantity integer,
  p_supplier_name text,
  p_invoice_number text,
  p_unit_cost numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hospital uuid;
  v_new_qty integer;
  v_performed_by uuid;
  v_notes text;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  v_hospital := public.auth_org();
  if v_hospital is null then
    raise exception 'no hospital context';
  end if;

  select pr.id
  into v_performed_by
  from public.practitioners pr
  where pr.hospital_id = v_hospital
    and (pr.user_id = auth.uid() or pr.id = auth.uid())
  limit 1;

  update public.hospital_inventory hi
  set stock_quantity = coalesce(hi.stock_quantity, 0) + p_quantity
  where hi.id = p_hospital_inventory_id
    and hi.hospital_id = v_hospital
  returning hi.stock_quantity into v_new_qty;

  if v_new_qty is null then
    raise exception 'inventory item not found or access denied';
  end if;

  insert into public.hospital_inventory_restock (
    hospital_inventory_id,
    batch_number,
    expiry_date,
    quantity,
    supplier_name,
    invoice_number,
    unit_cost,
    created_by
  )
  values (
    p_hospital_inventory_id,
    nullif(trim(coalesce(p_batch_number, '')), ''),
    p_expiry_date,
    p_quantity,
    nullif(trim(coalesce(p_supplier_name, '')), ''),
    nullif(trim(coalesce(p_invoice_number, '')), ''),
    p_unit_cost,
    auth.uid()
  );

  v_notes := nullif(trim(coalesce(p_invoice_number, '')), '');
  if v_notes is not null then
    v_notes := 'Invoice: ' || v_notes;
  end if;

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
    p_hospital_inventory_id,
    'restock',
    p_quantity,
    nullif(trim(coalesce(p_batch_number, '')), ''),
    nullif(trim(coalesce(p_supplier_name, '')), ''),
    v_notes,
    v_performed_by
  );
end;
$$;
