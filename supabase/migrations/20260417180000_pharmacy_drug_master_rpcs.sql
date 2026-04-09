-- Drug master admin RPCs over hospital_inventory (+ optional MRP). Admin gate matches staff/hospital profile.

alter table public.hospital_inventory
  add column if not exists mrp numeric(12, 2);

comment on column public.hospital_inventory.mrp is 'Maximum retail price reference for pharmacy drug master / labeling.';

-- ---------------------------------------------------------------------------
-- get_drugs — paginated list (50/page), optional text search; no heavy joins.
-- Returns JSON: { total, page, page_size, items: [...] }
-- ---------------------------------------------------------------------------
create or replace function public.get_drugs(
  p_hospital_id uuid,
  p_search text default null,
  p_page integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_limit int := 50;
  v_offset int;
  v_q text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_total bigint;
  v_items jsonb;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  v_offset := (v_page - 1) * v_limit;

  select count(*)::bigint into v_total
  from public.hospital_inventory hi
  where hi.hospital_id = p_hospital_id
    and (
      v_q is null
      or position(
        v_q in lower(
          coalesce(hi.generic_name, '') || ' ' || coalesce(hi.brand_name, '') || ' '
          || coalesce(hi.dosage_form_name, '') || ' ' || coalesce(hi.strength, '')
        )
      ) > 0
    );

  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'generic_name', x.generic_name,
          'brand_name', x.brand_name,
          'form', x.form,
          'strength', x.strength,
          'mrp', x.mrp,
          'min_stock', x.min_stock,
          'is_active', x.is_active
        )
        order by x.generic_name nulls last, x.brand_name nulls last
      )
      from (
        select
          hi.id,
          hi.generic_name,
          hi.brand_name,
          hi.dosage_form_name as form,
          hi.strength,
          hi.mrp,
          hi.reorder_level as min_stock,
          coalesce(hi.is_active, true) as is_active
        from public.hospital_inventory hi
        where hi.hospital_id = p_hospital_id
          and (
            v_q is null
            or position(
              v_q in lower(
                coalesce(hi.generic_name, '') || ' ' || coalesce(hi.brand_name, '') || ' '
                || coalesce(hi.dosage_form_name, '') || ' ' || coalesce(hi.strength, '')
              )
            ) > 0
          )
        order by hi.generic_name nulls last, hi.brand_name nulls last
        limit v_limit
        offset v_offset
      ) x
    ),
    '[]'::jsonb
  )
  into v_items;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'page_size', v_limit,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$fn$;

comment on function public.get_drugs(uuid, text, integer) is
  'Admin-only paginated drug master rows from hospital_inventory (50 per page).';

revoke all on function public.get_drugs(uuid, text, integer) from public;
grant execute on function public.get_drugs(uuid, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_drug — insert formulary line (stock 0)
-- ---------------------------------------------------------------------------
create or replace function public.create_drug(
  p_hospital_id uuid,
  p_generic_name text,
  p_brand_name text,
  p_form text,
  p_strength text,
  p_mrp numeric,
  p_min_stock integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_brand text;
  v_generic text;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  v_brand := trim(coalesce(p_brand_name, ''));
  v_generic := trim(coalesce(p_generic_name, ''));
  if v_brand = '' then
    raise exception 'brand_name is required';
  end if;
  if v_generic = '' then
    raise exception 'generic_name is required';
  end if;

  if p_min_stock is null or p_min_stock < 0 then
    raise exception 'min_stock must be non-negative';
  end if;

  if p_mrp is not null and p_mrp < 0 then
    raise exception 'mrp must be non-negative';
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
    is_active,
    mrp
  )
  values (
    p_hospital_id,
    v_brand,
    v_generic,
    nullif(trim(coalesce(p_form, '')), ''),
    nullif(trim(coalesce(p_strength, '')), ''),
    null,
    p_min_stock,
    null,
    0,
    true,
    p_mrp
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.create_drug(uuid, text, text, text, text, numeric, integer) is
  'Admin-only insert hospital_inventory drug row with stock 0.';

revoke all on function public.create_drug(uuid, text, text, text, text, numeric, integer) from public;
grant execute on function public.create_drug(uuid, text, text, text, text, numeric, integer) to authenticated, service_role;
