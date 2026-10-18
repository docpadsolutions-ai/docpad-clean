-- sync_practitioner_email() fires BEFORE INSERT on practitioners and reads auth.users.
-- It existed only in the live database (no file in the repo) and was not SECURITY
-- DEFINER, so it ran as the inserting role. service_role and authenticated have no
-- SELECT on auth.users, so every direct insert into practitioners failed with
--   42501 permission denied for table users
-- Only SECURITY DEFINER RPCs owned by postgres could create staff rows.
--
-- Behaviour is unchanged (email is still copied from auth.users on insert); the
-- function now runs as its owner. Execute is revoked from the API roles so this does
-- not add to the anon-executable SECURITY DEFINER list asserted in
-- supabase/tests/rls_isolation.sql. Trigger firing does not check EXECUTE.
--
-- Rollback: supabase/rollbacks/20261018050000_sync_practitioner_email_security_definer_rollback.sql

create or replace function public.sync_practitioner_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email = (select email from auth.users where id = new.user_id);
  return new;
end;
$$;

revoke all on function public.sync_practitioner_email() from public, anon, authenticated;
