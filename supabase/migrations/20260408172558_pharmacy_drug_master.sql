-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408172558.

create table public.drugs (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  generic_name text not null,
  brand_name text,
  category text,
  dosage_form text,
  strength text,
  manufacturer text,
  hsn_code text,
  purchase_price decimal(10,2),
  mrp decimal(10,2),
  markup_percent decimal(5,2),
  min_stock_level int default 10,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_drugs_hospital on public.drugs(hospital_id);
create index idx_drugs_generic_search on public.drugs(generic_name);

create table public.pharmacy_vendors (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  gstin text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create or replace function public.get_drugs(p_hospital_id uuid, p_search text default null)
returns table (id uuid, generic_name text, brand_name text, category text, dosage_form text, 
  strength text, mrp decimal, min_stock_level int, is_active boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not _caller_is_hospital_staff_admin(p_hospital_id) then raise exception 'not authorized'; end if;
  return query select d.id, d.generic_name, d.brand_name, d.category, d.dosage_form, 
    d.strength, d.mrp, d.min_stock_level, d.is_active
  from public.drugs d where d.hospital_id = p_hospital_id
    and (p_search is null or d.generic_name ilike '%' || p_search || '%' or d.brand_name ilike '%' || p_search || '%')
  order by d.generic_name;
end;
$$;

create or replace function public.create_drug(
  p_hospital_id uuid, p_generic_name text, p_brand_name text default null,
  p_category text default null, p_dosage_form text default null, p_strength text default null,
  p_manufacturer text default null, p_hsn_code text default null,
  p_purchase_price decimal default null, p_mrp decimal default null, p_markup_percent decimal default null,
  p_min_stock_level int default 10
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_drug_id uuid;
begin
  if not _caller_is_hospital_staff_admin(p_hospital_id) then raise exception 'not authorized'; end if;
  insert into public.drugs (hospital_id, generic_name, brand_name, category, dosage_form, strength,
    manufacturer, hsn_code, purchase_price, mrp, markup_percent, min_stock_level)
  values (p_hospital_id, p_generic_name, p_brand_name, p_category, p_dosage_form, p_strength,
    p_manufacturer, p_hsn_code, p_purchase_price, p_mrp, p_markup_percent, p_min_stock_level)
  returning id into v_drug_id;
  return v_drug_id;
end;
$$;

grant execute on function public.get_drugs, public.create_drug to authenticated, service_role;
