-- Detail RPCs for preauth/claim edit & view; widen dashboard lists to include drafts.

-- ---------------------------------------------------------------------------
-- get_preauth_by_id(p_id uuid)
-- ---------------------------------------------------------------------------

create or replace function public.get_preauth_by_id(p_id uuid)
returns table (
  id uuid,
  patient_id uuid,
  patient_full_name text,
  encounter_id uuid,
  insurance_company_id uuid,
  patient_insurance_coverage_id uuid,
  requested_amount numeric,
  estimated_amount numeric,
  procedures_json jsonb,
  diagnosis_codes_json jsonb,
  clinical_summary text,
  status text,
  insurance_name text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_id is null then
    raise exception 'id required';
  end if;

  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  select
    p.id,
    p.patient_id,
    coalesce(pt.full_name, '')::text as patient_full_name,
    p.encounter_id,
    p.insurance_company_id,
    p.patient_insurance_coverage_id,
    p.requested_amount,
    coalesce(p.estimated_amount, p.requested_amount, 0)::numeric as estimated_amount,
    coalesce(p.procedures_json, '[]'::jsonb) as procedures_json,
    coalesce(p.diagnosis_codes_json, '[]'::jsonb) as diagnosis_codes_json,
    p.clinical_summary,
    p.status,
    coalesce(ic.name, '—')::text as insurance_name
  from public.insurance_preauths p
  inner join public.patients pt on pt.id = p.patient_id
  left join public.insurance_companies ic on ic.id = p.insurance_company_id
  where p.id = p_id
    and p.hospital_id = v_hospital;
end;
$fn$;

comment on function public.get_preauth_by_id(uuid) is
  'Single preauth row for practitioner hospital (for edit/view UI).';

revoke all on function public.get_preauth_by_id(uuid) from public;
grant execute on function public.get_preauth_by_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_claim_by_id(p_id uuid)
-- ---------------------------------------------------------------------------

create or replace function public.get_claim_by_id(p_id uuid)
returns table (
  id uuid,
  patient_id uuid,
  patient_full_name text,
  claim_number text,
  billed_amount numeric,
  approved_amount numeric,
  settled_amount numeric,
  insurance_company_id uuid,
  insurance_name text,
  settlement_due_date date,
  status text,
  notes text,
  submitted_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_id is null then
    raise exception 'id required';
  end if;

  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  select
    c.id,
    c.patient_id,
    coalesce(pt.full_name, '')::text as patient_full_name,
    c.claim_number,
    c.billed_amount,
    c.approved_amount,
    c.settled_amount,
    c.insurance_company_id,
    coalesce(ic.name, '—')::text as insurance_name,
    c.settlement_due_date,
    c.status,
    c.notes,
    c.submitted_at,
    c.created_at
  from public.insurance_claims c
  inner join public.patients pt on pt.id = c.patient_id
  left join public.insurance_companies ic on ic.id = c.insurance_company_id
  where c.id = p_id
    and c.hospital_id = v_hospital;
end;
$fn$;

comment on function public.get_claim_by_id(uuid) is
  'Single insurance claim for practitioner hospital (for edit/view UI).';

revoke all on function public.get_claim_by_id(uuid) from public;
grant execute on function public.get_claim_by_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Widen list RPCs: include draft preauths + draft claims
-- ---------------------------------------------------------------------------

create or replace function public.get_pending_preauths()
returns table (
  id uuid,
  patient_id uuid,
  patient_full_name text,
  insurance_name text,
  requested_amount numeric,
  status text,
  days_pending integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  select
    p.id,
    p.patient_id,
    coalesce(pt.full_name, '')::text as patient_full_name,
    coalesce(ic.name, '—')::text as insurance_name,
    p.requested_amount,
    p.status,
    greatest(
      0,
      (
        timezone('utc', now())::date
        - (coalesce(p.submitted_at, p.created_at) at time zone 'utc')::date
      )::integer
    ) as days_pending
  from public.insurance_preauths p
  inner join public.patients pt on pt.id = p.patient_id
  left join public.insurance_companies ic on ic.id = p.insurance_company_id
  where p.hospital_id = v_hospital
    and p.status in (
      'draft',
      'pending',
      'submitted',
      'in_review',
      'approved',
      'rejected',
      'expired'
    )
  order by coalesce(p.submitted_at, p.created_at) desc;
end;
$fn$;

comment on function public.get_pending_preauths() is
  'Preauths for practitioner hospital (all statuses including draft), newest first.';

create or replace function public.get_claims_summary()
returns table (
  id uuid,
  claim_number text,
  patient_full_name text,
  billed_amount numeric,
  approved_amount numeric,
  settled_amount numeric,
  status text,
  settlement_due_date date
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  return query
  select
    c.id,
    c.claim_number,
    coalesce(pt.full_name, '')::text as patient_full_name,
    c.billed_amount,
    c.approved_amount,
    c.settled_amount,
    c.status,
    c.settlement_due_date
  from public.insurance_claims c
  inner join public.patients pt on pt.id = c.patient_id
  where c.hospital_id = v_hospital
  order by c.submitted_at desc nulls last, c.created_at desc;
end;
$fn$;

comment on function public.get_claims_summary() is
  'Insurance claims for practitioner hospital including drafts.';
