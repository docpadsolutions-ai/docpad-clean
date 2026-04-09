-- Fetch one vendor (admin) + full update.

-- ---------------------------------------------------------------------------
-- get_vendor — hospital admin only (same hospital as vendor row)
-- ---------------------------------------------------------------------------
create or replace function public.get_vendor(p_vendor_id uuid)
returns table (
  id uuid,
  hospital_id uuid,
  vendor_name text,
  contact_person text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  drug_license_no text,
  gst_no text,
  payment_terms_days integer,
  bank_details jsonb,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.hospital_id,
    v.vendor_name,
    v.contact_person,
    v.phone,
    v.email,
    v.address_line1,
    v.address_line2,
    v.city,
    v.state,
    v.pincode,
    v.drug_license_no,
    v.gst_no,
    v.payment_terms_days,
    v.bank_details,
    v.is_active
  from public.pharmacy_vendors v
  where v.id = p_vendor_id
    and public._caller_is_hospital_staff_admin(v.hospital_id);
$$;

comment on function public.get_vendor(uuid) is
  'Single pharmacy vendor row for edit; admin of that hospital only.';

revoke all on function public.get_vendor(uuid) from public;
grant execute on function public.get_vendor(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_vendor — hospital admin only
-- ---------------------------------------------------------------------------
create or replace function public.update_vendor(
  p_vendor_id uuid,
  p_vendor_name text,
  p_contact_person text,
  p_phone text,
  p_email text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_drug_license_no text,
  p_gst_no text,
  p_payment_terms_days integer,
  p_bank_details jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_vendor_id is null then
    raise exception 'vendor_id required';
  end if;

  select v.hospital_id into v_hospital
  from public.pharmacy_vendors v
  where v.id = p_vendor_id
  limit 1;

  if v_hospital is null then
    raise exception 'vendor not found';
  end if;

  if not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  if trim(coalesce(p_vendor_name, '')) = '' then
    raise exception 'vendor_name required';
  end if;
  if trim(coalesce(p_phone, '')) = '' then
    raise exception 'phone required';
  end if;
  if trim(coalesce(p_drug_license_no, '')) = '' then
    raise exception 'drug_license_no required';
  end if;

  update public.pharmacy_vendors v
  set
    vendor_name = trim(p_vendor_name),
    contact_person = nullif(trim(coalesce(p_contact_person, '')), ''),
    phone = trim(p_phone),
    email = nullif(trim(coalesce(p_email, '')), ''),
    address_line1 = nullif(trim(coalesce(p_address_line1, '')), ''),
    address_line2 = nullif(trim(coalesce(p_address_line2, '')), ''),
    city = nullif(trim(coalesce(p_city, '')), ''),
    state = nullif(trim(coalesce(p_state, '')), ''),
    pincode = nullif(trim(coalesce(p_pincode, '')), ''),
    drug_license_no = trim(p_drug_license_no),
    gst_no = nullif(trim(coalesce(p_gst_no, '')), ''),
    payment_terms_days = coalesce(p_payment_terms_days, 30),
    bank_details = case
      when p_bank_details is null or p_bank_details = '{}'::jsonb then null
      else p_bank_details
    end,
    updated_at = now()
  where v.id = p_vendor_id;
end;
$fn$;

comment on function public.update_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb) is
  'Update pharmacy_vendors row; caller must be hospital staff admin.';

revoke all on function public.update_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb) from public;
grant execute on function public.update_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb)
  to authenticated, service_role;
