-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408163437.

-- Rename hospital_name to name for consistency
alter table public.hospitals rename column hospital_name to name;

-- Add all missing columns
alter table public.hospitals add column if not exists hfr_id text;
alter table public.hospitals add column if not exists nabh_accredited boolean default false;
alter table public.hospitals add column if not exists nabh_certificate_number text;
alter table public.hospitals add column if not exists nabh_valid_until date;
alter table public.hospitals add column if not exists address_line1 text;
alter table public.hospitals add column if not exists address_line2 text;
alter table public.hospitals add column if not exists city text;
alter table public.hospitals add column if not exists state text;
alter table public.hospitals add column if not exists pincode text;
alter table public.hospitals add column if not exists phone text;
alter table public.hospitals add column if not exists email text;
alter table public.hospitals add column if not exists website text;
alter table public.hospitals add column if not exists created_at timestamptz default now();
alter table public.hospitals add column if not exists updated_at timestamptz default now();

-- Add comments
comment on table public.hospitals is 'Hospital facility profiles for ABDM/NABH compliance';
comment on column public.hospitals.hfr_id is 'ABDM Health Facility Registry ID';
comment on column public.hospitals.nabh_accredited is 'NABH accreditation status';

-- Create RPCs
create or replace function public.get_hospital_profile(p_hospital_id uuid)
returns table (
  id uuid, name text, hfr_id text, nabh_accredited boolean,
  nabh_certificate_number text, nabh_valid_until date,
  address_line1 text, address_line2 text, city text, state text, pincode text,
  phone text, email text, website text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;
  
  if not _caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;
  
  return query 
  select h.id, h.name, h.hfr_id, h.nabh_accredited,
    h.nabh_certificate_number, h.nabh_valid_until,
    h.address_line1, h.address_line2, h.city, h.state, h.pincode,
    h.phone, h.email, h.website
  from public.hospitals h 
  where h.id = p_hospital_id;
end;
$$;

create or replace function public.update_hospital_profile(
  p_hospital_id uuid,
  p_name text, 
  p_hfr_id text, 
  p_nabh_accredited boolean,
  p_nabh_cert text, 
  p_nabh_valid date,
  p_addr1 text, 
  p_addr2 text, 
  p_city text, 
  p_state text, 
  p_pin text,
  p_phone text, 
  p_email text, 
  p_website text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;
  
  if not _caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;
  
  update public.hospitals set
    name = p_name, 
    hfr_id = p_hfr_id, 
    nabh_accredited = p_nabh_accredited,
    nabh_certificate_number = p_nabh_cert, 
    nabh_valid_until = p_nabh_valid,
    address_line1 = p_addr1, 
    address_line2 = p_addr2, 
    city = p_city, 
    state = p_state, 
    pincode = p_pin,
    phone = p_phone, 
    email = p_email, 
    website = p_website, 
    updated_at = now()
  where id = p_hospital_id;
end;
$$;

comment on function public.get_hospital_profile(uuid) is 'Admin-only: fetch hospital profile';
comment on function public.update_hospital_profile is 'Admin-only: update hospital profile';

revoke all on function public.get_hospital_profile(uuid) from public;
revoke all on function public.update_hospital_profile from public;
grant execute on function public.get_hospital_profile(uuid) to authenticated, service_role;
grant execute on function public.update_hospital_profile to authenticated, service_role;
