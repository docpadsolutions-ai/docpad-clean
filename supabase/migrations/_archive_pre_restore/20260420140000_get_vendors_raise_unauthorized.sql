-- get_vendors: raise when not admin / null hospital (avoid silent empty list vs create_vendor).

create or replace function public.get_vendors(p_hospital_id uuid, p_status text default 'all')
returns table (
  id uuid,
  vendor_name text,
  contact_person text,
  phone text,
  drug_license_no text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_filter text;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  v_filter := lower(trim(coalesce(p_status, 'all')));
  if v_filter not in ('all', 'active', 'inactive') then
    v_filter := 'all';
  end if;

  return query
  select
    v.id,
    v.vendor_name,
    v.contact_person,
    v.phone,
    v.drug_license_no,
    v.is_active
  from public.pharmacy_vendors v
  where v.hospital_id = p_hospital_id
    and (
      v_filter = 'all'
      or (v_filter = 'active' and v.is_active)
      or (v_filter = 'inactive' and not v.is_active)
    )
  order by v.vendor_name nulls last, v.created_at desc;
end;
$fn$;

comment on function public.get_vendors(uuid, text) is
  'Pharmacy vendors for p_hospital_id; p_status all | active | inactive; admin only (raises if not).';
