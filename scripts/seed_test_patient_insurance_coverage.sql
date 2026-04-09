-- Seed one active patient_insurance_coverage row for preauth UI testing.
-- Target schema: patient_insurance_coverage with sum_insured, balance_sum_insured,
-- coverage_start_date, coverage_end_date, status, corporate_panel_id → public.corporate_panels.
-- (This differs from older repo migrations that used coverage_limit / remaining_balance / valid_until
--  and insurance_corporate_panels.)

-- Idempotent: skips if policy_number 'TEST-POL-001' already exists.
insert into public.patient_insurance_coverage (
  patient_id,
  corporate_panel_id,
  policy_number,
  sum_insured,
  balance_sum_insured,
  status,
  coverage_start_date,
  coverage_end_date
)
select
  p.id,
  cp.id,
  'TEST-POL-001',
  500000,
  500000,
  'active',
  (timezone('utc', now()))::date,
  ((timezone('utc', now()))::date + interval '1 year')::date
from public.patients p
inner join public.corporate_panels cp on cp.hospital_id = p.hospital_id
where not exists (select 1 from public.patient_insurance_coverage pic where pic.policy_number = 'TEST-POL-001')
order by p.created_at desc nulls last
limit 1;
