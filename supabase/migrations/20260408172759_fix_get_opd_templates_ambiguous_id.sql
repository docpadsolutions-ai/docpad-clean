-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408172759.

drop function if exists public.get_opd_templates(uuid, uuid, text);

create or replace function public.get_opd_templates(
  p_hospital_id uuid, 
  p_department_id uuid default null,
  p_name_search text default null
)
returns table (
  template_id uuid, 
  name text, 
  template_type text, 
  department_id uuid, 
  is_default boolean, 
  is_active boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists(select 1 from practitioners where hospital_id = p_hospital_id and (user_id = auth.uid() or id = auth.uid())) then
    raise exception 'not authorized';
  end if;
  
  return query 
  select 
    t.id as template_id, 
    t.name, 
    t.template_type, 
    t.department_id, 
    t.is_default, 
    t.is_active
  from public.opd_templates t
  where t.hospital_id = p_hospital_id
    and (p_department_id is null or t.department_id = p_department_id)
    and (p_name_search is null or t.name ilike '%' || p_name_search || '%')
  order by t.is_default desc, t.name;
end;
$$;

grant execute on function public.get_opd_templates to authenticated, service_role;
