-- OPD encounter note / form templates per department (structure JSONB loaded only on detail).

create table if not exists public.opd_templates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  template_type text not null default 'consultation',
  is_default boolean not null default false,
  is_active boolean not null default true,
  structure jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists opd_templates_hospital_dept_idx
  on public.opd_templates (hospital_id, department_id);

create index if not exists opd_templates_hospital_name_idx
  on public.opd_templates (hospital_id, lower(name));

comment on table public.opd_templates is
  'Reusable OPD documentation templates; list views omit structure jsonb.';

alter table public.opd_templates enable row level security;

drop policy if exists "opd_templates_select_hospital" on public.opd_templates;

create policy "opd_templates_select_hospital"
on public.opd_templates
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = opd_templates.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select on public.opd_templates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers: admin gate + default uniqueness per department
-- ---------------------------------------------------------------------------
create or replace function public._opd_template_clear_default_peers(
  p_hospital_id uuid,
  p_department_id uuid,
  p_except_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.opd_templates t
  set is_default = false, updated_at = now()
  where t.hospital_id = p_hospital_id
    and t.department_id = p_department_id
    and t.id is distinct from p_except_id
    and t.is_default = true;
end;
$fn$;

revoke all on function public._opd_template_clear_default_peers(uuid, uuid, uuid) from public;
grant execute on function public._opd_template_clear_default_peers(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- get_opd_templates — no structure column
-- ---------------------------------------------------------------------------
create or replace function public.get_opd_templates(
  p_hospital_id uuid,
  p_department_id uuid,
  p_name_search text default null
)
returns table (
  id uuid,
  name text,
  template_type text,
  department_id uuid,
  department_name text,
  is_default boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_q text := nullif(lower(trim(coalesce(p_name_search, ''))), '');
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  return query
  select
    t.id,
    t.name::text,
    t.template_type::text,
    t.department_id,
    coalesce(nullif(trim(d.name), ''), '—')::text as department_name,
    coalesce(t.is_default, false) as is_default,
    coalesce(t.is_active, true) as is_active
  from public.opd_templates t
  inner join public.departments d on d.id = t.department_id and d.hospital_id = p_hospital_id
  where t.hospital_id = p_hospital_id
    and (p_department_id is null or t.department_id = p_department_id)
    and (v_q is null or position(v_q in lower(t.name)) > 0)
  order by d.name nulls last, t.name nulls last;
end;
$fn$;

comment on function public.get_opd_templates(uuid, uuid, text) is
  'Admin-only template list without structure jsonb.';

revoke all on function public.get_opd_templates(uuid, uuid, text) from public;
grant execute on function public.get_opd_templates(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_opd_template_detail — includes structure
-- ---------------------------------------------------------------------------
create or replace function public.get_opd_template_detail(p_template_id uuid)
returns table (
  id uuid,
  hospital_id uuid,
  department_id uuid,
  department_name text,
  name text,
  template_type text,
  is_default boolean,
  is_active boolean,
  structure jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_template_id is null then
    raise exception 'template_id required';
  end if;

  select t.hospital_id into v_hospital
  from public.opd_templates t
  where t.id = p_template_id
  limit 1;

  if v_hospital is null then
    return;
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  return query
  select
    t.id,
    t.hospital_id,
    t.department_id,
    coalesce(nullif(trim(d.name), ''), '—')::text as department_name,
    t.name::text,
    t.template_type::text,
    coalesce(t.is_default, false) as is_default,
    coalesce(t.is_active, true) as is_active,
    t.structure,
    t.created_at,
    t.updated_at
  from public.opd_templates t
  inner join public.departments d on d.id = t.department_id
  where t.id = p_template_id
  limit 1;
end;
$fn$;

comment on function public.get_opd_template_detail(uuid) is
  'Admin-only single template including structure jsonb.';

revoke all on function public.get_opd_template_detail(uuid) from public;
grant execute on function public.get_opd_template_detail(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_opd_template
-- ---------------------------------------------------------------------------
create or replace function public.create_opd_template(
  p_hospital_id uuid,
  p_department_id uuid,
  p_name text,
  p_template_type text,
  p_structure jsonb,
  p_is_default boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_struct jsonb := coalesce(p_structure, '{}'::jsonb);
  v_default boolean := coalesce(p_is_default, false);
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if p_department_id is null then
    raise exception 'department_id required';
  end if;

  if not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.hospital_id = p_hospital_id
  ) then
    raise exception 'department not in this hospital';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_template_type is null or btrim(p_template_type) = '' then
    raise exception 'template_type is required';
  end if;

  if v_default then
    perform public._opd_template_clear_default_peers(p_hospital_id, p_department_id, null);
  end if;

  insert into public.opd_templates (
    hospital_id,
    department_id,
    name,
    template_type,
    structure,
    is_default,
    is_active
  )
  values (
    p_hospital_id,
    p_department_id,
    btrim(p_name),
    btrim(p_template_type),
    v_struct,
    v_default,
    true
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.create_opd_template(uuid, uuid, text, text, jsonb, boolean) is
  'Admin-only create template; optional default clears peers in department.';

revoke all on function public.create_opd_template(uuid, uuid, text, text, jsonb, boolean) from public;
grant execute on function public.create_opd_template(uuid, uuid, text, text, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_opd_template (detail save)
-- ---------------------------------------------------------------------------
create or replace function public.update_opd_template(
  p_template_id uuid,
  p_name text,
  p_template_type text,
  p_department_id uuid,
  p_structure jsonb,
  p_is_default boolean,
  p_is_active boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_old_dept uuid;
begin
  if p_template_id is null then
    raise exception 'template_id required';
  end if;

  select t.hospital_id, t.department_id
  into v_hospital, v_old_dept
  from public.opd_templates t
  where t.id = p_template_id
  limit 1;

  if v_hospital is null then
    raise exception 'template not found';
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  if p_department_id is null then
    raise exception 'department_id required';
  end if;

  if not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.hospital_id = v_hospital
  ) then
    raise exception 'department not in this hospital';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_template_type is null or btrim(p_template_type) = '' then
    raise exception 'template_type is required';
  end if;

  if coalesce(p_is_default, false) then
    perform public._opd_template_clear_default_peers(v_hospital, p_department_id, p_template_id);
  end if;

  update public.opd_templates t
  set
    department_id = p_department_id,
    name = btrim(p_name),
    template_type = btrim(p_template_type),
    structure = coalesce(p_structure, '{}'::jsonb),
    is_default = coalesce(p_is_default, false),
    is_active = coalesce(p_is_active, true),
    updated_at = now()
  where t.id = p_template_id;
end;
$fn$;

comment on function public.update_opd_template(uuid, text, text, uuid, jsonb, boolean, boolean) is
  'Admin-only full template update including structure.';

revoke all on function public.update_opd_template(uuid, text, text, uuid, jsonb, boolean, boolean) from public;
grant execute on function public.update_opd_template(uuid, text, text, uuid, jsonb, boolean, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- patch_opd_template_flags — inline toggles (list page)
-- ---------------------------------------------------------------------------
create or replace function public.patch_opd_template_flags(
  p_template_id uuid,
  p_is_active boolean default null,
  p_is_default boolean default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_dept uuid;
  v_active boolean;
begin
  if p_template_id is null then
    raise exception 'template_id required';
  end if;

  select t.hospital_id, t.department_id, t.is_active
  into v_hospital, v_dept, v_active
  from public.opd_templates t
  where t.id = p_template_id
  limit 1;

  if v_hospital is null then
    raise exception 'template not found';
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  if p_is_active is not null then
    update public.opd_templates t
    set is_active = p_is_active, updated_at = now()
    where t.id = p_template_id;
  end if;

  if p_is_default is not null then
    if p_is_default then
      perform public._opd_template_clear_default_peers(v_hospital, v_dept, p_template_id);
      update public.opd_templates t
      set is_default = true, updated_at = now()
      where t.id = p_template_id;
    else
      update public.opd_templates t
      set is_default = false, updated_at = now()
      where t.id = p_template_id;
    end if;
  end if;
end;
$fn$;

comment on function public.patch_opd_template_flags(uuid, boolean, boolean) is
  'Admin-only partial update for list toggles.';

revoke all on function public.patch_opd_template_flags(uuid, boolean, boolean) from public;
grant execute on function public.patch_opd_template_flags(uuid, boolean, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- delete_opd_template
-- ---------------------------------------------------------------------------
create or replace function public.delete_opd_template(p_template_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_template_id is null then
    raise exception 'template_id required';
  end if;

  select t.hospital_id into v_hospital
  from public.opd_templates t
  where t.id = p_template_id
  limit 1;

  if v_hospital is null then
    raise exception 'template not found';
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  delete from public.opd_templates t where t.id = p_template_id;
end;
$fn$;

comment on function public.delete_opd_template(uuid) is 'Admin-only delete template row.';

revoke all on function public.delete_opd_template(uuid) from public;
grant execute on function public.delete_opd_template(uuid) to authenticated, service_role;
