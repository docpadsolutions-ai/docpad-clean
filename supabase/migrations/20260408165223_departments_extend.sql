-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408165223.

alter table public.departments add column if not exists specialty text;
alter table public.departments add column if not exists opd_hours_start time;
alter table public.departments add column if not exists opd_hours_end time;
alter table public.departments add column if not exists slot_duration_minutes int default 15;
alter table public.departments add column if not exists consultation_fee decimal(10,2);
alter table public.departments add column if not exists updated_at timestamptz default now();

create or replace function public.get_departments(p_hospital_id uuid)
returns table (
  id uuid, name text, specialty text, is_active boolean,
  opd_hours_start time, opd_hours_end time, slot_duration_minutes int,
  consultation_fee decimal
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_hospital_id is null then raise exception 'hospital_id required'; end if;
  if not _caller_is_hospital_staff_admin(p_hospital_id) then raise exception 'not authorized'; end if;
  
  return query 
  select d.id, d.name, d.specialty, d.is_active,
    d.opd_hours_start, d.opd_hours_end, d.slot_duration_minutes, d.consultation_fee
  from public.departments d where d.hospital_id = p_hospital_id order by d.name;
end;
$$;

create or replace function public.create_department(
  p_hospital_id uuid, p_name text, p_specialty text default null,
  p_opd_hours_start time default '09:00', p_opd_hours_end time default '17:00',
  p_slot_duration_minutes int default 15, p_consultation_fee decimal default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_dept_id uuid;
begin
  if not _caller_is_hospital_staff_admin(p_hospital_id) then raise exception 'not authorized'; end if;
  insert into public.departments (hospital_id, name, specialty, opd_hours_start, opd_hours_end, slot_duration_minutes, consultation_fee)
  values (p_hospital_id, p_name, p_specialty, p_opd_hours_start, p_opd_hours_end, p_slot_duration_minutes, p_consultation_fee)
  returning id into v_dept_id;
  return v_dept_id;
end;
$$;

create or replace function public.update_department(
  p_department_id uuid, p_name text default null, p_specialty text default null,
  p_is_active boolean default null, p_opd_hours_start time default null,
  p_opd_hours_end time default null, p_slot_duration_minutes int default null,
  p_consultation_fee decimal default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare v_hospital_id uuid;
begin
  select hospital_id into v_hospital_id from public.departments where id = p_department_id;
  if not _caller_is_hospital_staff_admin(v_hospital_id) then raise exception 'not authorized'; end if;
  update public.departments set
    name = coalesce(p_name, name), specialty = coalesce(p_specialty, specialty),
    is_active = coalesce(p_is_active, is_active),
    opd_hours_start = coalesce(p_opd_hours_start, opd_hours_start),
    opd_hours_end = coalesce(p_opd_hours_end, opd_hours_end),
    slot_duration_minutes = coalesce(p_slot_duration_minutes, slot_duration_minutes),
    consultation_fee = coalesce(p_consultation_fee, consultation_fee), updated_at = now()
  where id = p_department_id;
end;
$$;

grant execute on function public.get_departments, public.create_department, public.update_department to authenticated, service_role;
