-- List + deactivate vendors (admin).

alter table public.pharmacy_vendors
  add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- get_vendors — hospital admin only
-- ---------------------------------------------------------------------------
create or replace function public.get_vendors(p_hospital_id uuid)
returns table (
  id uuid,
  vendor_name text,
  contact_person text,
  phone text,
  drug_license_no text,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.vendor_name,
    v.contact_person,
    v.phone,
    v.drug_license_no,
    v.is_active
  from public.pharmacy_vendors v
  where v.hospital_id = p_hospital_id
    and public._caller_is_hospital_staff_admin(p_hospital_id)
  order by v.vendor_name nulls last, v.created_at desc;
$$;

comment on function public.get_vendors(uuid) is
  'Active + inactive pharmacy vendors for one hospital; admin only.';

revoke all on function public.get_vendors(uuid) from public;
grant execute on function public.get_vendors(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- deactivate_vendor — hospital admin only
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_vendor(p_vendor_id uuid)
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

  update public.pharmacy_vendors v
  set is_active = false, updated_at = now()
  where v.id = p_vendor_id;
end;
$fn$;

comment on function public.deactivate_vendor(uuid) is
  'Soft-deactivate a vendor (is_active = false); admin only.';

revoke all on function public.deactivate_vendor(uuid) from public;
grant execute on function public.deactivate_vendor(uuid) to authenticated, service_role;
