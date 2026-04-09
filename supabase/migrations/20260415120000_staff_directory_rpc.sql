-- Staff directory: columns, admin-only RPCs joining auth.users for last sign-in.
-- Note: practitioners RLS is unchanged here (enabling RLS without full policy set would break invites/upserts).
-- Listing is enforced in-app (admin routes) + SECURITY DEFINER RPC below.

alter table public.practitioners
  add column if not exists is_active boolean not null default true;

alter table public.practitioners
  add column if not exists hpr_id text;

alter table public.practitioners
  add column if not exists designation text;

comment on column public.practitioners.is_active is
  'When false, staff is deactivated (directory + future license flows).';

comment on column public.practitioners.hpr_id is
  'Healthcare Professional Registry id when captured.';

comment on column public.practitioners.designation is
  'Clinical sub-role (e.g. consultant tier); mirrors invitation designation.';

-- ---------------------------------------------------------------------------
-- Admin gate: caller has a practitioner row in this hospital with admin privileges
-- (aligned with app rawRoleHasAdminPrivileges heuristics).
-- ---------------------------------------------------------------------------
create or replace function public._caller_is_hospital_staff_admin(p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = p_hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      and (
        lower(trim(coalesce(pr.user_role, ''))) in ('admin', 'administrator')
        or lower(trim(coalesce(pr.role, ''))) in ('admin', 'administrator')
        or lower(coalesce(pr.user_role, '') || ' ' || coalesce(pr.role, '')) ~ '(administrator|superuser|sysadmin|superadmin)'
        or lower(coalesce(pr.user_role, '') || ' ' || coalesce(pr.role, '')) ~ '(^|[^[:alnum:]])admin([^[:alnum:]]|$)'
      )
  );
$$;

comment on function public._caller_is_hospital_staff_admin(uuid) is
  'True when auth user is a hospital staff row in p_hospital_id with admin-like role text.';

revoke all on function public._caller_is_hospital_staff_admin(uuid) from public;
grant execute on function public._caller_is_hospital_staff_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Optional RLS: hospital peers can SELECT practitioners in the same hospital.
-- Safe alongside existing unauthenticated patterns only when coordinated with INSERT policies.
-- Uncomment in a follow-up migration if you enable RLS on practitioners globally.
-- ---------------------------------------------------------------------------
-- alter table public.practitioners enable row level security;
-- create policy "practitioners_select_same_hospital_peers"
-- on public.practitioners for select to authenticated
-- using (
--   exists (
--     select 1 from public.practitioners me
--     where me.hospital_id = practitioners.hospital_id
--       and (me.user_id = (select auth.uid()) or me.id = (select auth.uid()))
--   )
-- );

-- ---------------------------------------------------------------------------
-- get_all_staff: directory rows for one hospital (admin only).
-- ---------------------------------------------------------------------------
create or replace function public.get_all_staff(p_hospital_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  sub_role text,
  hpr_id text,
  is_active boolean,
  last_login timestamptz
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
    p.id,
    coalesce(nullif(trim(p.full_name), ''), '—')::text as full_name,
    coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''))::text as email,
    coalesce(nullif(trim(p.user_role), ''), nullif(trim(p.role), ''), '—')::text as role,
    coalesce(nullif(trim(p.designation), ''), '—')::text as sub_role,
    nullif(trim(p.hpr_id), '')::text as hpr_id,
    coalesce(p.is_active, true) as is_active,
    u.last_sign_in_at as last_login
  from public.practitioners p
  left join auth.users u on u.id = p.user_id
  where p.hospital_id = p_hospital_id
  order by full_name nulls last;
end;
$fn$;

comment on function public.get_all_staff(uuid) is
  'Admin-only staff directory for a hospital; last_login from auth.users.last_sign_in_at.';

revoke all on function public.get_all_staff(uuid) from public;
grant execute on function public.get_all_staff(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_staff_directory_entry: single row for detail page (admin + same hospital).
-- ---------------------------------------------------------------------------
create or replace function public.get_staff_directory_entry(p_practitioner_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  sub_role text,
  hpr_id text,
  is_active boolean,
  last_login timestamptz
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
    coalesce(p.is_active, true) as is_active,
    u.last_sign_in_at as last_login
  from public.practitioners p
  left join auth.users u on u.id = p.user_id
  where p.id = p_practitioner_id
  limit 1;
end;
$fn$;

comment on function public.get_staff_directory_entry(uuid) is
  'Admin-only single staff row for detail view.';

revoke all on function public.get_staff_directory_entry(uuid) from public;
grant execute on function public.get_staff_directory_entry(uuid) to authenticated, service_role;
