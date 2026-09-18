-- Hospital profile (organizations row): admin read/update via SECURITY DEFINER RPCs.
-- DocPad scopes hospitals as public.organizations (practitioners.hospital_id).

alter table public.organizations
  add column if not exists address_line1 text;

alter table public.organizations
  add column if not exists city text;

alter table public.organizations
  add column if not exists state text;

alter table public.organizations
  add column if not exists pincode text;

alter table public.organizations
  add column if not exists phone text;

alter table public.organizations
  add column if not exists email text;

alter table public.organizations
  add column if not exists website text;

alter table public.organizations
  add column if not exists hfr_id text;

alter table public.organizations
  add column if not exists nabh_accredited boolean not null default false;

alter table public.organizations
  add column if not exists nabh_certificate_number text;

alter table public.organizations
  add column if not exists nabh_valid_until date;

comment on column public.organizations.address_line1 is 'Primary street / building address line.';
comment on column public.organizations.nabh_accredited is 'Hospital is NABH accredited.';
comment on column public.organizations.hfr_id is 'Healthcare Facility Registry id when applicable.';

-- ---------------------------------------------------------------------------
-- get_hospital_profile: single org row for admin in same hospital.
-- ---------------------------------------------------------------------------
create or replace function public.get_hospital_profile(p_hospital_id uuid)
returns table (
  id uuid,
  name text,
  address_line1 text,
  phone text,
  city text,
  state text,
  pincode text,
  email text,
  website text,
  hfr_id text,
  nabh_accredited boolean,
  nabh_certificate_number text,
  nabh_valid_until date
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
    o.id,
    coalesce(nullif(trim(o.name), ''), '—')::text as name,
    nullif(trim(o.address_line1), '')::text as address_line1,
    nullif(trim(o.phone), '')::text as phone,
    nullif(trim(o.city), '')::text as city,
    nullif(trim(o.state), '')::text as state,
    nullif(trim(o.pincode), '')::text as pincode,
    nullif(trim(o.email), '')::text as email,
    nullif(trim(o.website), '')::text as website,
    nullif(trim(o.hfr_id), '')::text as hfr_id,
    coalesce(o.nabh_accredited, false) as nabh_accredited,
    nullif(trim(o.nabh_certificate_number), '')::text as nabh_certificate_number,
    o.nabh_valid_until
  from public.organizations o
  where o.id = p_hospital_id
  limit 1;
end;
$fn$;

comment on function public.get_hospital_profile(uuid) is
  'Admin-only: read hospital/organization profile for p_hospital_id.';

revoke all on function public.get_hospital_profile(uuid) from public;
grant execute on function public.get_hospital_profile(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_hospital_profile: admin-only; required name, phone, address_line1, city, state, pincode.
-- ---------------------------------------------------------------------------
create or replace function public.update_hospital_profile(
  p_hospital_id uuid,
  p_name text,
  p_address_line1 text,
  p_phone text,
  p_city text,
  p_state text,
  p_pincode text,
  p_email text,
  p_website text,
  p_hfr_id text,
  p_nabh_accredited boolean,
  p_nabh_certificate_number text,
  p_nabh_valid_until date
)
returns void
language plpgsql
volatile
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

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_address_line1 is null or btrim(p_address_line1) = '' then
    raise exception 'address_line1 is required';
  end if;
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'phone is required';
  end if;
  if p_city is null or btrim(p_city) = '' then
    raise exception 'city is required';
  end if;
  if p_state is null or btrim(p_state) = '' then
    raise exception 'state is required';
  end if;
  if p_pincode is null or btrim(p_pincode) = '' then
    raise exception 'pincode is required';
  end if;

  if not exists (select 1 from public.organizations o where o.id = p_hospital_id) then
    raise exception 'hospital not found';
  end if;

  update public.organizations o
  set
    name = btrim(p_name),
    address_line1 = btrim(p_address_line1),
    phone = btrim(p_phone),
    city = btrim(p_city),
    state = btrim(p_state),
    pincode = btrim(p_pincode),
    email = nullif(btrim(coalesce(p_email, '')), ''),
    website = nullif(btrim(coalesce(p_website, '')), ''),
    hfr_id = nullif(btrim(coalesce(p_hfr_id, '')), ''),
    nabh_accredited = coalesce(p_nabh_accredited, false),
    nabh_certificate_number = case
      when coalesce(p_nabh_accredited, false) then nullif(btrim(coalesce(p_nabh_certificate_number, '')), '')
      else null
    end,
    nabh_valid_until = case
      when coalesce(p_nabh_accredited, false) then p_nabh_valid_until
      else null
    end
  where o.id = p_hospital_id;
end;
$fn$;

comment on function public.update_hospital_profile(uuid, text, text, text, text, text, text, text, text, text, boolean, text, date) is
  'Admin-only: update organization profile; NABH cert fields cleared when not accredited.';

revoke all on function public.update_hospital_profile(uuid, text, text, text, text, text, text, text, text, text, boolean, text, date) from public;
grant execute on function public.update_hospital_profile(uuid, text, text, text, text, text, text, text, text, text, boolean, text, date) to authenticated, service_role;
