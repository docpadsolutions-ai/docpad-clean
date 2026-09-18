-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408163054.

-- Add optional phone and specialization to practitioners
alter table public.practitioners
  add column if not exists phone text;

alter table public.practitioners
  add column if not exists specialization text;

comment on column public.practitioners.phone is
  'Contact phone number for staff member.';

comment on column public.practitioners.specialization is
  'Clinical specialization (e.g. Cardiology, Orthopedics).';

-- Add updated_at to invitations and backfill from created_at
alter table public.invitations
  add column if not exists updated_at timestamptz default now();

-- Backfill updated_at from created_at for existing rows
update public.invitations
set updated_at = created_at
where updated_at is null;

-- Create trigger to auto-update updated_at on invitations
create or replace function public.update_invitations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists invitations_update_timestamp on public.invitations;

create trigger invitations_update_timestamp
  before update on public.invitations
  for each row
  execute function public.update_invitations_updated_at();

-- Drop existing function to change return type
drop function if exists public.get_staff_directory_entry(uuid);

-- Recreate with extended fields
create or replace function public.get_staff_directory_entry(p_practitioner_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  sub_role text,
  hpr_id text,
  phone text,
  specialization text,
  is_active boolean,
  last_login timestamptz,
  account_created_at timestamptz,
  invite_accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_practitioner_id is null then
    raise exception 'practitioner_id required';
  end if;

  select p.hospital_id into v_hospital
  from public.practitioners p
  where p.id = p_practitioner_id
  limit 1;

  if v_hospital is null then
    return;
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(trim(p.full_name), ''), '—')::text as full_name,
    coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''))::text as email,
    coalesce(nullif(trim(p.user_role), ''), nullif(trim(p.role), ''), '—')::text as role,
    coalesce(nullif(trim(p.designation), ''), '—')::text as sub_role,
    nullif(trim(p.hpr_id), '')::text as hpr_id,
    nullif(trim(p.phone), '')::text as phone,
    nullif(trim(p.specialization), '')::text as specialization,
    coalesce(p.is_active, true) as is_active,
    u.last_sign_in_at as last_login,
    u.created_at as account_created_at,
    (
      select max(coalesce(inv.updated_at, inv.created_at))
      from public.invitations inv
      where inv.hospital_id = v_hospital
        and lower(trim(inv.email)) = lower(trim(coalesce(p.email, u.email)))
        and inv.status = 'accepted'
    ) as invite_accepted_at
  from public.practitioners p
  left join auth.users u on u.id = p.user_id
  where p.id = p_practitioner_id
  limit 1;
end;
$fn$;

comment on function public.get_staff_directory_entry(uuid) is
  'Admin-only single staff row with extended fields: phone, specialization, account_created_at, invite_accepted_at.';

revoke all on function public.get_staff_directory_entry(uuid) from public;
grant execute on function public.get_staff_directory_entry(uuid) to authenticated, service_role;
