-- create_vendor: nested p_address + p_bank_details; hospital from auth_org().

drop function if exists public.create_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb);

create or replace function public.create_vendor(
  p_vendor_name text,
  p_contact_person text,
  p_phone text,
  p_email text,
  p_address jsonb,
  p_drug_license_no text,
  p_gst_no text,
  p_payment_terms_days integer,
  p_bank_details jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_hospital uuid;
  v_addr jsonb;
  v_bank jsonb;
  v_line1 text;
  v_line2 text;
  v_city text;
  v_state text;
  v_pincode text;
  v_acct text;
  v_ifsc text;
  v_bank_name text;
  v_branch text;
begin
  v_hospital := public.auth_org();
  if v_hospital is null or not public._caller_is_hospital_staff_admin(v_hospital) then
    raise exception 'not authorized';
  end if;

  v_addr := coalesce(p_address, '{}'::jsonb);
  v_line1 := nullif(trim(coalesce(v_addr->>'line1', '')), '');
  v_line2 := nullif(trim(coalesce(v_addr->>'line2', '')), '');
  v_city := nullif(trim(coalesce(v_addr->>'city', '')), '');
  v_state := nullif(trim(coalesce(v_addr->>'state', '')), '');
  v_pincode := nullif(trim(coalesce(v_addr->>'pincode', '')), '');

  v_bank := coalesce(p_bank_details, '{}'::jsonb);
  v_acct := trim(coalesce(v_bank->>'account_no', ''));
  v_ifsc := trim(coalesce(v_bank->>'ifsc', ''));
  v_bank_name := trim(coalesce(v_bank->>'bank_name', ''));
  v_branch := trim(coalesce(v_bank->>'branch', ''));

  if trim(coalesce(p_vendor_name, '')) = '' then
    raise exception 'vendor_name required';
  end if;
  if trim(coalesce(p_phone, '')) = '' then
    raise exception 'phone required';
  end if;
  if trim(coalesce(p_drug_license_no, '')) = '' then
    raise exception 'drug_license_no required';
  end if;

  insert into public.pharmacy_vendors (
    hospital_id,
    vendor_name,
    contact_person,
    phone,
    email,
    address_line1,
    address_line2,
    city,
    state,
    pincode,
    drug_license_no,
    gst_no,
    payment_terms_days,
    bank_details
  )
  values (
    v_hospital,
    trim(p_vendor_name),
    nullif(trim(coalesce(p_contact_person, '')), ''),
    trim(p_phone),
    nullif(trim(coalesce(p_email, '')), ''),
    v_line1,
    v_line2,
    v_city,
    v_state,
    v_pincode,
    trim(p_drug_license_no),
    nullif(trim(coalesce(p_gst_no, '')), ''),
    coalesce(p_payment_terms_days, 30),
    case
      when v_acct = '' and v_ifsc = '' and v_bank_name = '' and v_branch = '' then null
      else jsonb_build_object(
        'account_no', nullif(v_acct, ''),
        'ifsc', nullif(upper(v_ifsc), ''),
        'bank_name', nullif(v_bank_name, ''),
        'branch', nullif(v_branch, '')
      )
    end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.create_vendor(text, text, text, text, jsonb, text, text, integer, jsonb) is
  'Insert pharmacy_vendors; p_address {line1,line2,city,state,pincode}; hospital from auth_org(); admin only.';

revoke all on function public.create_vendor(text, text, text, text, jsonb, text, text, integer, jsonb) from public;
grant execute on function public.create_vendor(text, text, text, text, jsonb, text, text, integer, jsonb)
  to authenticated, service_role;
