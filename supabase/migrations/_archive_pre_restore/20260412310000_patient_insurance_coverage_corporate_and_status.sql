-- Links coverage to corporate panels + explicit status / start date.
-- Maps: sum_insured → coverage_limit, balance_sum_insured → remaining_balance, coverage_end_date → valid_until.

alter table public.patient_insurance_coverage
  add column if not exists corporate_panel_id uuid references public.insurance_corporate_panels (id) on delete set null;

alter table public.patient_insurance_coverage
  add column if not exists status text not null default 'active';

alter table public.patient_insurance_coverage
  add column if not exists coverage_start_date date;

alter table public.patient_insurance_coverage drop constraint if exists patient_insurance_coverage_status_check;

alter table public.patient_insurance_coverage
  add constraint patient_insurance_coverage_status_check check (status in ('active', 'inactive', 'expired'));

comment on column public.patient_insurance_coverage.corporate_panel_id is
  'Optional link to hospital corporate / panel agreement.';

comment on column public.patient_insurance_coverage.status is
  'Coverage lifecycle; only active rows are returned by get_patient_insurance_coverage.';

comment on column public.patient_insurance_coverage.coverage_start_date is
  'Policy / benefit start date (optional; eligibility may still use valid_until).';

-- Active coverage: valid_until null or future, and status active (null treated as active for legacy rows).
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
    coalesce(ic.name, pic.insurance_name_raw, '-')::text as insurance_company_name,
    coalesce(pic.tpa_name, '')::text as tpa_name,
    coalesce(pic.coverage_limit, 0)::numeric as sum_insured,
    coalesce(pic.remaining_balance, 0)::numeric as balance,
    pic.valid_until
  from public.patient_insurance_coverage pic
  left join public.insurance_companies ic on ic.id = pic.insurance_company_id
  where pic.patient_id = p_patient_id
    and pic.hospital_id = v_hospital
    and (pic.status is null or pic.status = 'active')
    and (
      pic.valid_until is null
      or pic.valid_until >= (timezone('utc', now()))::date
    )
  order by pic.created_at desc;
end;
$fn$;

comment on function public.get_patient_insurance_coverage(uuid) is
  'Active coverage rows for patient in practitioner hospital (status active, valid_until null or future).';

revoke all on function public.get_patient_insurance_coverage(uuid) from public;
grant execute on function public.get_patient_insurance_coverage(uuid) to authenticated, service_role;
