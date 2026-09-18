-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408165104.

drop function if exists public.update_hospital_profile;

create or replace function public.update_hospital_profile(
  p_hospital_id uuid,
  p_name text default null,
  p_hfr_id text default null,
  p_nabh_accredited boolean default null,
  p_nabh_certificate_number text default null,
  p_nabh_valid_until date default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_pincode text default null,
  p_phone text default null,
  p_email text default null,
  p_website text default null
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
    name = coalesce(p_name, name),
    hfr_id = coalesce(p_hfr_id, hfr_id),
    nabh_accredited = coalesce(p_nabh_accredited, nabh_accredited),
    nabh_certificate_number = coalesce(p_nabh_certificate_number, nabh_certificate_number),
    nabh_valid_until = coalesce(p_nabh_valid_until, nabh_valid_until),
    address_line1 = coalesce(p_address_line1, address_line1),
    address_line2 = coalesce(p_address_line2, address_line2),
    city = coalesce(p_city, city),
    state = coalesce(p_state, state),
    pincode = coalesce(p_pincode, pincode),
    phone = coalesce(p_phone, phone),
    email = coalesce(p_email, email),
    website = coalesce(p_website, website),
    updated_at = now()
  where id = p_hospital_id;
end;
$$;

grant execute on function public.update_hospital_profile to authenticated, service_role;
