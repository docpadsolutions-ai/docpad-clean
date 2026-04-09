-- Pharmacy vendors (hospital-scoped). Admin-only create via RPC.

create table if not exists public.pharmacy_vendors (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  vendor_name text not null,
  contact_person text,
  phone text not null,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  drug_license_no text not null,
  gst_no text,
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0 and payment_terms_days <= 3650),
  bank_details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pharmacy_vendors_hospital_idx on public.pharmacy_vendors (hospital_id);

comment on table public.pharmacy_vendors is 'Wholesale / distributor vendors linked to a hospital formulary.';
comment on column public.pharmacy_vendors.bank_details is 'Optional JSON: account_no, ifsc, bank_name, branch.';

alter table public.pharmacy_vendors enable row level security;

-- ---------------------------------------------------------------------------
-- create_vendor — hospital admin only
-- ---------------------------------------------------------------------------
create or replace function public.create_vendor(
  p_hospital_id uuid,
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
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
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
    p_hospital_id,
    trim(p_vendor_name),
    nullif(trim(coalesce(p_contact_person, '')), ''),
    trim(p_phone),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_address_line1, '')), ''),
    nullif(trim(coalesce(p_address_line2, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_state, '')), ''),
    nullif(trim(coalesce(p_pincode, '')), ''),
    trim(p_drug_license_no),
    nullif(trim(coalesce(p_gst_no, '')), ''),
    coalesce(p_payment_terms_days, 30),
    case
      when p_bank_details is null or p_bank_details = '{}'::jsonb then null
      else p_bank_details
    end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.create_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb) is
  'Insert pharmacy_vendors row; caller must be hospital staff admin.';

revoke all on function public.create_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb) from public;
grant execute on function public.create_vendor(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, jsonb)
  to authenticated, service_role;
