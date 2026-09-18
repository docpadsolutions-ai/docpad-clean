-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917170033.

-- practitioners_update_own let any signed-in user change their own role, hospital or active flag
-- directly through the API (e.g. user_role = 'admin'). Direct API updates may now only change
-- profile fields; admin RPCs (SECURITY DEFINER, run as the owner) are unaffected.
create or replace function public.trg_practitioners_protect_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.id          is distinct from old.id
    or new.user_id     is distinct from old.user_id
    or new.hospital_id is distinct from old.hospital_id
    or new.role        is distinct from old.role
    or new.user_role   is distinct from old.user_role
    or new.privileges  is distinct from old.privileges
    or new.is_active   is distinct from old.is_active
  ) then
    raise exception 'Changing role, hospital, privileges or active status requires an administrator.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_practitioners_protect_privileged_columns() from public, anon, authenticated;

drop trigger if exists practitioners_protect_privileged_columns on public.practitioners;
create trigger practitioners_protect_privileged_columns
  before update on public.practitioners
  for each row execute function public.trg_practitioners_protect_privileged_columns();

-- Hide the plaintext security answer from colleagues (practitioners_select_hospital exposes whole rows).
-- Nothing in the app reads this column.
revoke select (security_answer) on public.practitioners from anon, authenticated;
