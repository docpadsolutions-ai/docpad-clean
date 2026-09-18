-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408170542.

create table public.opd_templates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  template_type text check (template_type in ('general', 'specialty', 'procedure')),
  structure jsonb not null default '{}',
  is_default boolean default false,
  is_active boolean default true,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.opd_templates is 'Clinical documentation templates per specialty';
comment on column public.opd_templates.structure is 'JSON schema: sections, fields, vitals checklist';

create index idx_opd_templates_hospital on public.opd_templates(hospital_id);
create index idx_opd_templates_dept on public.opd_templates(department_id);

create or replace function public.get_opd_templates(p_hospital_id uuid, p_department_id uuid default null)
returns table (id uuid, name text, template_type text, department_id uuid, is_default boolean, is_active boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists(select 1 from practitioners where hospital_id = p_hospital_id and (user_id = auth.uid() or id = auth.uid())) then
    raise exception 'not authorized';
  end if;
  
  return query select t.id, t.name, t.template_type, t.department_id, t.is_default, t.is_active
  from public.opd_templates t
  where t.hospital_id = p_hospital_id
    and (p_department_id is null or t.department_id = p_department_id)
  order by t.is_default desc, t.name;
end;
$$;

grant execute on function public.get_opd_templates to authenticated, service_role;
