-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408084320.

drop function if exists public.get_patient_insurance_coverage(uuid);

create function public.get_patient_insurance_coverage(p_patient_id uuid)
returns table (
  coverage_id uuid,
  insurance_company_id uuid,
  policy_number text,
  insurance_company_name text,
  tpa_name text,
  sum_insured numeric,
  balance numeric,
  valid_until date
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_patient_id is null then
    raise exception 'patient_id required';
  end if;

  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  select
    pic.id as coverage_id,
    pic.insurance_company_id,
    coalesce(pic.policy_number, '')::text as policy_number,
    coalesce(ic.name, '-')::text as insurance_company_name,
    coalesce(t.name, '')::text as tpa_name,
    coalesce(pic.sum_insured, 0)::numeric as sum_insured,
    coalesce(pic.balance_sum_insured, 0)::numeric as balance,
    pic.coverage_end_date as valid_until
  from public.patient_insurance_coverage pic
  inner join public.patients pt on pt.id = pic.patient_id and pt.hospital_id = v_hospital
  left join public.insurance_companies ic on ic.id = pic.insurance_company_id
  left join public.tpas t on t.id = pic.tpa_id
  where pic.patient_id = p_patient_id
    and pic.status = 'active'
    and (
      pic.coverage_end_date is null
      or pic.coverage_end_date >= (timezone('utc', now()))::date
    )
  order by pic.created_at desc;
end;
$fn$;

comment on function public.get_patient_insurance_coverage(uuid) is
  'Active coverage for patient in practitioner hospital (via patients.hospital_id). Returns sum_insured/balance and coverage_end_date as valid_until.';

revoke all on function public.get_patient_insurance_coverage(uuid) from public;
grant execute on function public.get_patient_insurance_coverage(uuid) to authenticated, service_role;
