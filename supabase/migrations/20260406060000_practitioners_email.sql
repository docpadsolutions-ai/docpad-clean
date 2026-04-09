-- Denormalized email for server-side jobs (e.g. send-expiry-alerts) and reporting; primary source remains auth.users.

alter table public.practitioners add column if not exists email text;

comment on column public.practitioners.email is
  'Contact/login email; backfilled from auth.users. New rows with user_id copy from auth when email is null/blank (trigger).';

update public.practitioners p
set email = au.email
from auth.users au
where p.user_id is not null
  and au.id = p.user_id
  and au.email is not null
  and au.email <> ''
  and (p.email is null or btrim(p.email) = '');

create or replace function public.practitioners_sync_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text;
begin
  if new.user_id is null then
    return new;
  end if;
  if new.email is not null and btrim(new.email) <> '' then
    return new;
  end if;
  select u.email into auth_email from auth.users u where u.id = new.user_id;
  if auth_email is not null and auth_email <> '' then
    new.email := auth_email;
  end if;
  return new;
end;
$$;

comment on function public.practitioners_sync_email_from_auth() is
  'BEFORE INSERT/UPDATE OF user_id: if practitioners.email is blank, copy auth.users.email for new.user_id.';

drop trigger if exists practitioners_sync_email_from_auth on public.practitioners;

create trigger practitioners_sync_email_from_auth
before insert or update of user_id on public.practitioners
for each row
execute function public.practitioners_sync_email_from_auth();
