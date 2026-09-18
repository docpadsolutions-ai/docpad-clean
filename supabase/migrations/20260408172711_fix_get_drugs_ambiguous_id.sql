-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408172711.

drop function if exists public.get_drugs(uuid, text);

create or replace function public.get_drugs(p_hospital_id uuid, p_search text default null)
returns table (
  drug_id uuid, 
  generic_name text, 
  brand_name text, 
  category text, 
  dosage_form text, 
  strength text, 
  mrp decimal, 
  min_stock_level int, 
  is_active boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not _caller_is_hospital_staff_admin(p_hospital_id) then 
    raise exception 'not authorized'; 
  end if;
  
  return query 
  select 
    d.id as drug_id, 
    d.generic_name, 
    d.brand_name, 
    d.category, 
    d.dosage_form, 
    d.strength, 
    d.mrp, 
    d.min_stock_level, 
    d.is_active
  from public.drugs d 
  where d.hospital_id = p_hospital_id
    and (p_search is null or d.generic_name ilike '%' || p_search || '%' or d.brand_name ilike '%' || p_search || '%')
  order by d.generic_name;
end;
$$;

grant execute on function public.get_drugs to authenticated, service_role;
