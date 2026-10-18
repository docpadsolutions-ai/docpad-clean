-- Restores sync_practitioner_email() exactly as it was before
-- 20261018050000_sync_practitioner_email_security_definer.sql (live definition read
-- 18 Oct 2026). Note that this brings back the 42501 failure on direct inserts.

create or replace function public.sync_practitioner_email()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  new.email = (select email from auth.users where id = new.user_id);
  return new;
end;
$$;

grant execute on function public.sync_practitioner_email() to public, anon, authenticated, service_role;
