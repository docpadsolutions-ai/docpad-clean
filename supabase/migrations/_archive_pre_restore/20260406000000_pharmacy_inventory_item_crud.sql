-- Extra catalog fields + soft-delete; CRUD RPCs for pharmacy inventory UI.
alter table public.hospital_inventory add column if not exists strength text;
alter table public.hospital_inventory add column if not exists manufacturer text;
alter table public.hospital_inventory add column if not exists storage_conditions text;
alter table public.hospital_inventory add column if not exists is_active boolean not null default true;

alter table public.hospital_inventory add column if not exists dosage_form_name text;

create index if not exists hospital_inventory_hospital_active_brand_idx
  on public.hospital_inventory (hospital_id, brand_name)
  where is_active = true;

-- Add formulary line (stock starts at 0; use restock_medication to increase).
create or replace function public.add_inventory_item(
  p_hospital_id uuid,
  p_brand_name text,
  p_generic_name text,
  p_dosage_form text,
  p_strength text,
  p_manufacturer text,
  p_reorder_level integer,
  p_storage_conditions text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_brand text;
  v_generic text;
begin
  v_org := public.auth_org();
  if v_org is null then
    raise exception 'no hospital context';
  end if;
  if p_hospital_id is distinct from v_org then
    raise exception 'hospital mismatch';
  end if;

  v_brand := trim(coalesce(p_brand_name, ''));
  v_generic := trim(coalesce(p_generic_name, ''));
  if v_brand = '' then
    raise exception 'brand_name is required';
  end if;
  if v_generic = '' then
    raise exception 'generic_name is required';
  end if;

  insert into public.hospital_inventory (
    hospital_id,
    brand_name,
    generic_name,
    dosage_form_name,
    strength,
    manufacturer,
    reorder_level,
    storage_conditions,
    stock_quantity,
    is_active
  )
  values (
    p_hospital_id,
    v_brand,
    v_generic,
    nullif(trim(coalesce(p_dosage_form, '')), ''),
    nullif(trim(coalesce(p_strength, '')), ''),
    nullif(trim(coalesce(p_manufacturer, '')), ''),
    coalesce(p_reorder_level, 10),
    nullif(trim(coalesce(p_storage_conditions, '')), ''),
    0,
    true
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_inventory_item(
  p_item_id uuid,
  p_brand_name text,
  p_generic_name text,
  p_reorder_level integer,
  p_storage_conditions text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_brand text;
  v_generic text;
  v_n integer;
begin
  v_org := public.auth_org();
  if v_org is null then
    raise exception 'no hospital context';
  end if;

  v_brand := trim(coalesce(p_brand_name, ''));
  v_generic := trim(coalesce(p_generic_name, ''));
  if v_brand = '' then
    raise exception 'brand_name is required';
  end if;
  if v_generic = '' then
    raise exception 'generic_name is required';
  end if;

  update public.hospital_inventory hi
  set
    brand_name = v_brand,
    generic_name = v_generic,
    reorder_level = case
      when p_reorder_level is null then hi.reorder_level
      else p_reorder_level
    end,
    storage_conditions = nullif(trim(coalesce(p_storage_conditions, '')), '')
  where hi.id = p_item_id
    and hi.hospital_id = v_org
    and hi.is_active = true;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'inventory item not found or access denied';
  end if;
end;
$$;

create or replace function public.deactivate_inventory_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_n integer;
begin
  v_org := public.auth_org();
  if v_org is null then
    raise exception 'no hospital context';
  end if;

  update public.hospital_inventory hi
  set is_active = false
  where hi.id = p_item_id
    and hi.hospital_id = v_org;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'inventory item not found or access denied';
  end if;
end;
$$;

grant execute on function public.add_inventory_item(
  uuid, text, text, text, text, text, integer, text
) to authenticated;

grant execute on function public.update_inventory_item(
  uuid, text, text, integer, text
) to authenticated;

grant execute on function public.deactivate_inventory_item(uuid) to authenticated;

comment on function public.add_inventory_item(uuid, text, text, text, text, text, integer, text) is
  'Insert hospital_inventory row (stock 0); p_hospital_id must equal auth_org().';

comment on function public.update_inventory_item(uuid, text, text, integer, text) is
  'Update brand, generic, reorder_level, storage_conditions for active item in auth_org().';

comment on function public.deactivate_inventory_item(uuid) is
  'Soft-delete formulary row (is_active false) for auth_org() hospital.';
