-- Pass explicit hospital (tenant) instead of reading auth_org() inside the function
drop function if exists public.pharmacy_dispensed_today_count();

create or replace function public.pharmacy_dispensed_today_count(p_hospital_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.prescriptions p
  inner join public.patients pt on pt.id = p.patient_id
  where pt.hospital_id = p_hospital_id
    and public.auth_org() is not null
    and p_hospital_id = public.auth_org()
    and p.status = 'dispensed'
    and p.dispensed_at is not null
    and p.dispensed_at::date = current_date;
$$;

grant execute on function public.pharmacy_dispensed_today_count(uuid) to authenticated;

comment on function public.pharmacy_dispensed_today_count(uuid) is 'Daily dispensed line count for a hospital: dispensed_at::date = current_date.';
