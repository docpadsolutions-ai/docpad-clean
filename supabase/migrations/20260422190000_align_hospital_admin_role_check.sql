-- Align DB admin gate with app/lib/userRole.ts `rawRoleHasAdminPrivileges` (word-boundary + superuser/sysadmin).
-- Fixes RLS on feature_flags (and any other policy using _caller_is_hospital_staff_admin) when role text is e.g. "Hospital Admin" not exactly "admin".

create or replace function public.raw_role_text_has_admin_privilege(p_raw text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then false
    else (
      lower(btrim(p_raw)) ~ '(^|[^[:alnum:]])admin([^[:alnum:]]|$)'
      or lower(btrim(p_raw)) ~ '(^|[^[:alnum:]])administrator([^[:alnum:]]|$)'
      or lower(btrim(p_raw)) like '%superuser%'
      or lower(btrim(p_raw)) like '%sysadmin%'
      or lower(btrim(p_raw)) like '%superadmin%'
    )
  end;
$$;

comment on function public.raw_role_text_has_admin_privilege(text) is
  'Mirrors app rawRoleHasAdminPrivileges for RLS; checks user_role and role columns.';

revoke all on function public.raw_role_text_has_admin_privilege(text) from public;

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
        public.raw_role_text_has_admin_privilege(pr.user_role::text)
        or public.raw_role_text_has_admin_privilege(pr.role::text)
      )
  );
$$;

comment on function public._caller_is_hospital_staff_admin(uuid) is
  'True when session user has a practitioner row in p_hospital_id with admin-like role (aligned with app heuristics).';

revoke all on function public._caller_is_hospital_staff_admin(uuid) from public;
grant execute on function public._caller_is_hospital_staff_admin(uuid) to authenticated, service_role;
