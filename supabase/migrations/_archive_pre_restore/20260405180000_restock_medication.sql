-- Audit trail for pharmacy restocks (optional reporting)
create table if not exists public.hospital_inventory_restock (
  id uuid primary key default gen_random_uuid(),
  hospital_inventory_id uuid not null references public.hospital_inventory (id) on delete cascade,
  batch_number text,
  expiry_date date,
  quantity integer not null,
  supplier_name text,
  invoice_number text,
  unit_cost numeric(14, 4),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists hospital_inventory_restock_inv_idx
  on public.hospital_inventory_restock (hospital_inventory_id);

comment on table public.hospital_inventory_restock is 'Pharmacy restock events (batch, supplier, invoice); stock updated via restock_medication().';

-- Requires public.auth_org() (see app/lib/authOrg.ts)
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
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  v_hospital := public.auth_org();
  if v_hospital is null then
    raise exception 'no hospital context';
  end if;

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
end;
$$;

grant execute on function public.restock_medication(
  uuid,
  text,
  date,
  integer,
  text,
  text,
  numeric
) to authenticated;
