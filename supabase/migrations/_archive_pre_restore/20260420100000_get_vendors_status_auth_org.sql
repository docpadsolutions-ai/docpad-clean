-- List vendors by caller hospital (auth_org) + optional status filter.

drop function if exists public.get_vendors(uuid);

create or replace function public.get_vendors(p_status text default 'all')
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
  v_hospital uuid;
  v_filter text;
begin
  v_hospital := public.auth_org();
  if v_hospital is null or not public._caller_is_hospital_staff_admin(v_hospital) then
    return;
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
  where v.hospital_id = v_hospital
    and (
      v_filter = 'all'
      or (v_filter = 'active' and v.is_active)
      or (v_filter = 'inactive' and not v.is_active)
    )
  order by v.vendor_name nulls last, v.created_at desc;
end;
$fn$;

comment on function public.get_vendors(text) is
  'Pharmacy vendors for auth_org() hospital; p_status all | active | inactive; hospital admin only.';

revoke all on function public.get_vendors(text) from public;
grant execute on function public.get_vendors(text) to authenticated, service_role;
