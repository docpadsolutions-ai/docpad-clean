-- OPD scheduling + billing fields on departments; admin RPCs (same gate as staff/hospital profile).

alter table public.departments
  add column if not exists specialty text;

alter table public.departments
  add column if not exists opd_hours_start time without time zone;

alter table public.departments
  add column if not exists opd_hours_end time without time zone;

alter table public.departments
  add column if not exists slot_duration_minutes integer;

alter table public.departments
  add column if not exists consultation_fee numeric(12, 2);

comment on column public.departments.specialty is 'Clinical specialty label for OPD (e.g. Cardiology).';
comment on column public.departments.opd_hours_start is 'OPD window start (local hospital time).';
comment on column public.departments.opd_hours_end is 'OPD window end (local hospital time).';
comment on column public.departments.slot_duration_minutes is 'Default consultation slot length in minutes.';
comment on column public.departments.consultation_fee is 'Default OPD consultation fee for this department.';

update public.departments
set slot_duration_minutes = 15
where slot_duration_minutes is null;

update public.departments
set consultation_fee = 0
where consultation_fee is null;

alter table public.departments
  alter column slot_duration_minutes set default 15;

alter table public.departments
  alter column consultation_fee set default 0;

alter table public.departments
  alter column slot_duration_minutes set not null;

alter table public.departments
  alter column consultation_fee set not null;

-- ---------------------------------------------------------------------------
-- get_departments
-- ---------------------------------------------------------------------------
create or replace function public.get_departments(p_hospital_id uuid)
returns table (
  id uuid,
  name text,
  specialty text,
  opd_hours_start time without time zone,
  opd_hours_end time without time zone,
  slot_duration_minutes integer,
  consultation_fee numeric,
  is_active boolean,
  type text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  return query
  select
    d.id,
    d.name,
    nullif(trim(d.specialty), '')::text as specialty,
    d.opd_hours_start,
    d.opd_hours_end,
    coalesce(d.slot_duration_minutes, 15) as slot_duration_minutes,
    coalesce(d.consultation_fee, 0::numeric) as consultation_fee,
    coalesce(d.is_active, true) as is_active,
    d.type::text
  from public.departments d
  where d.hospital_id = p_hospital_id
  order by d.name nulls last;
end;
$fn$;

comment on function public.get_departments(uuid) is
  'Admin-only: list departments for a hospital with OPD/fee fields.';

revoke all on function public.get_departments(uuid) from public;
grant execute on function public.get_departments(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_department
-- ---------------------------------------------------------------------------
create or replace function public.create_department(
  p_hospital_id uuid,
  p_name text,
  p_specialty text,
  p_opd_hours_start time without time zone,
  p_opd_hours_end time without time zone,
  p_slot_duration_minutes integer,
  p_consultation_fee numeric
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_opd_hours_start is null or p_opd_hours_end is null then
    raise exception 'opd_hours_start and opd_hours_end are required';
  end if;
  if p_opd_hours_end <= p_opd_hours_start then
    raise exception 'opd_hours_end must be after opd_hours_start';
  end if;
  if p_slot_duration_minutes is null or p_slot_duration_minutes < 5 or p_slot_duration_minutes > 240 then
    raise exception 'slot_duration_minutes must be between 5 and 240';
  end if;
  if p_consultation_fee is null or p_consultation_fee < 0 then
    raise exception 'consultation_fee must be non-negative';
  end if;

  insert into public.departments (
    hospital_id,
    name,
    code,
    type,
    specialty,
    opd_hours_start,
    opd_hours_end,
    slot_duration_minutes,
    consultation_fee,
    is_active
  )
  values (
    p_hospital_id,
    btrim(p_name),
    null,
    'clinical',
    nullif(btrim(coalesce(p_specialty, '')), ''),
    p_opd_hours_start,
    p_opd_hours_end,
    p_slot_duration_minutes,
    p_consultation_fee,
    true
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.create_department(uuid, text, text, time, time, integer, numeric) is
  'Admin-only: create a clinical department with OPD window and fee.';

revoke all on function public.create_department(uuid, text, text, time, time, integer, numeric) from public;
grant execute on function public.create_department(uuid, text, text, time, time, integer, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_department
-- ---------------------------------------------------------------------------
create or replace function public.update_department(
  p_department_id uuid,
  p_name text,
  p_specialty text,
  p_opd_hours_start time without time zone,
  p_opd_hours_end time without time zone,
  p_slot_duration_minutes integer,
  p_consultation_fee numeric,
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
begin
  if p_department_id is null then
    raise exception 'department_id required';
  end if;

  select d.hospital_id into v_hospital
  from public.departments d
  where d.id = p_department_id
  limit 1;

  if v_hospital is null then
    raise exception 'department not found';
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_opd_hours_start is null or p_opd_hours_end is null then
    raise exception 'opd_hours_start and opd_hours_end are required';
  end if;
  if p_opd_hours_end <= p_opd_hours_start then
    raise exception 'opd_hours_end must be after opd_hours_start';
  end if;
  if p_slot_duration_minutes is null or p_slot_duration_minutes < 5 or p_slot_duration_minutes > 240 then
    raise exception 'slot_duration_minutes must be between 5 and 240';
  end if;
  if p_consultation_fee is null or p_consultation_fee < 0 then
    raise exception 'consultation_fee must be non-negative';
  end if;

  update public.departments d
  set
    name = btrim(p_name),
    specialty = nullif(btrim(coalesce(p_specialty, '')), ''),
    opd_hours_start = p_opd_hours_start,
    opd_hours_end = p_opd_hours_end,
    slot_duration_minutes = p_slot_duration_minutes,
    consultation_fee = p_consultation_fee,
    is_active = coalesce(p_is_active, true)
  where d.id = p_department_id;
end;
$fn$;

comment on function public.update_department(uuid, text, text, time, time, integer, numeric, boolean) is
  'Admin-only: update department OPD fields and active flag.';

revoke all on function public.update_department(uuid, text, text, time, time, integer, numeric, boolean) from public;
grant execute on function public.update_department(uuid, text, text, time, time, integer, numeric, boolean) to authenticated, service_role;
