-- Client INSERT/UPDATE/DELETE on feature_flags hits RLS WITH CHECK; if admin detection fails, use this RPC.
-- SECURITY DEFINER runs as function owner (postgres): DML bypasses RLS after explicit admin check inside the function.

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

revoke all on function public._caller_is_hospital_staff_admin(uuid) from public;
grant execute on function public._caller_is_hospital_staff_admin(uuid) to authenticated, service_role;

create or replace function public.set_feature_flag_for_hospital(
  p_hospital_id uuid,
  p_flag_name text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_flag_name is null or btrim(p_flag_name) = '' then
    raise exception 'flag key required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized to manage feature flags';
  end if;

  if p_enabled then
    update public.feature_flags
    set updated_at = now()
    where hospital_id = p_hospital_id and feature_key = btrim(p_flag_name);
    get diagnostics n = row_count;
    if n = 0 then
      insert into public.feature_flags (hospital_id, feature_key, updated_at)
      values (p_hospital_id, btrim(p_flag_name), now());
    end if;
  else
    delete from public.feature_flags
    where hospital_id = p_hospital_id and feature_key = btrim(p_flag_name);
  end if;
end;
$$;

comment on function public.set_feature_flag_for_hospital(uuid, text, boolean) is
  'Admin-only: insert/update/delete feature_flags row; bypasses RLS after _caller_is_hospital_staff_admin.';

revoke all on function public.set_feature_flag_for_hospital(uuid, text, boolean) from public;
grant execute on function public.set_feature_flag_for_hospital(uuid, text, boolean) to authenticated;
