-- Staff detail: optional phone/specialization on practitioners; richer get_staff_directory_entry.

alter table public.practitioners
  add column if not exists phone text;

alter table public.practitioners
  add column if not exists specialization text;

comment on column public.practitioners.phone is
  'Contact phone when captured at signup or profile.';

comment on column public.practitioners.specialization is
  'Clinical specialization (e.g. department/specialty) when captured.';

alter table public.invitations
  add column if not exists updated_at timestamptz default now();

update public.invitations
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

-- Keep updated_at fresh when invitation row changes (if no trigger exists).
drop trigger if exists invitations_set_updated_at on public.invitations;

create or replace function public.invitations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger invitations_set_updated_at
before update on public.invitations
for each row
execute function public.invitations_touch_updated_at();

create or replace function public.get_staff_directory_entry(p_practitioner_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  role text,
  sub_role text,
  hpr_id text,
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
    nullif(trim(p.phone), '')::text as phone,
    coalesce(nullif(trim(p.user_role), ''), nullif(trim(p.role), ''), '—')::text as role,
    coalesce(nullif(trim(p.designation), ''), '—')::text as sub_role,
    nullif(trim(p.hpr_id), '')::text as hpr_id,
    nullif(trim(p.specialization), '')::text as specialization,
    coalesce(p.is_active, true) as is_active,
    u.last_sign_in_at as last_login,
    u.created_at as account_created_at,
    (
      select max(coalesce(inv.updated_at, inv.created_at))
      from public.invitations inv
      where inv.hospital_id = v_hospital
        and inv.status = 'accepted'
        and lower(trim(inv.email)) = lower(trim(coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''))))
    )::timestamptz as invite_accepted_at
  from public.practitioners p
  left join auth.users u on u.id = p.user_id
  where p.id = p_practitioner_id
  limit 1;
end;
$fn$;

comment on function public.get_staff_directory_entry(uuid) is
  'Admin-only single staff row: contact, professional fields, auth timestamps, invite accepted.';
