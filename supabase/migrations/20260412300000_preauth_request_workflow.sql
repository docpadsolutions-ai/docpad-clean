-- Preauth request form: extended columns, draft workflow, coverage + upsert RPCs.

-- ---------------------------------------------------------------------------
-- patient_insurance_coverage: TPA label (optional)
-- ---------------------------------------------------------------------------
alter table public.patient_insurance_coverage
  add column if not exists tpa_name text;

comment on column public.patient_insurance_coverage.tpa_name is
  'Third-party administrator name when distinct from insurer.';

-- ---------------------------------------------------------------------------
-- insurance_preauths: draft + structured payload
-- ---------------------------------------------------------------------------
alter table public.insurance_preauths
  add column if not exists encounter_id uuid references public.opd_encounters (id) on delete set null;

alter table public.insurance_preauths
  add column if not exists patient_insurance_coverage_id uuid references public.patient_insurance_coverage (id) on delete set null;

alter table public.insurance_preauths
  add column if not exists estimated_amount numeric(14, 2);

alter table public.insurance_preauths
  add column if not exists procedures_json jsonb not null default '[]'::jsonb;

alter table public.insurance_preauths
  add column if not exists diagnosis_codes_json jsonb not null default '[]'::jsonb;

alter table public.insurance_preauths
  add column if not exists clinical_summary text;

update public.insurance_preauths
set estimated_amount = requested_amount
where estimated_amount is null;

alter table public.insurance_preauths
  alter column estimated_amount set default 0;

-- Replace status check to allow draft
alter table public.insurance_preauths drop constraint if exists insurance_preauths_status_check;

alter table public.insurance_preauths
  add constraint insurance_preauths_status_check check (
    status in (
      'draft',
      'pending',
      'submitted',
      'in_review',
      'approved',
      'rejected',
      'expired'
    )
  );

-- Default new rows to draft for form-created requests; legacy rows stay as-is
alter table public.insurance_preauths
  alter column status set default 'draft';

create index if not exists insurance_preauths_encounter_idx
  on public.insurance_preauths (encounter_id)
  where encounter_id is not null;

-- ---------------------------------------------------------------------------
-- get_patient_insurance_coverage(p_patient_id uuid)
-- ---------------------------------------------------------------------------

create or replace function public.get_patient_insurance_coverage(p_patient_id uuid)
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
    coalesce(ic.name, pic.insurance_name_raw, '—')::text as insurance_company_name,
    coalesce(pic.tpa_name, '')::text as tpa_name,
    coalesce(pic.coverage_limit, 0)::numeric as sum_insured,
    coalesce(pic.remaining_balance, 0)::numeric as balance,
    pic.valid_until
  from public.patient_insurance_coverage pic
  left join public.insurance_companies ic on ic.id = pic.insurance_company_id
  where pic.patient_id = p_patient_id
    and pic.hospital_id = v_hospital
    and (
      pic.valid_until is null
      or pic.valid_until >= (timezone('utc', now()))::date
    )
  order by pic.created_at desc;
end;
$fn$;

comment on function public.get_patient_insurance_coverage(uuid) is
  'Active coverage rows for patient in practitioner hospital (valid_until null or future).';

revoke all on function public.get_patient_insurance_coverage(uuid) from public;
grant execute on function public.get_patient_insurance_coverage(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- upsert_preauth_request(...)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_preauth_request(
  p_preauth_id uuid,
  p_patient_id uuid,
  p_encounter_id uuid,
  p_insurance_company_id uuid,
  p_coverage_id uuid,
  p_estimated_amount numeric,
  p_procedures jsonb,
  p_diagnosis jsonb,
  p_clinical_summary text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_id uuid;
  v_proc jsonb := coalesce(p_procedures, '[]'::jsonb);
  v_dx jsonb := coalesce(p_diagnosis, '[]'::jsonb);
  v_amt numeric := coalesce(p_estimated_amount, 0);
  v_summary text := nullif(trim(coalesce(p_clinical_summary, '')), '');
begin
  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  if p_patient_id is null then
    raise exception 'patient_id required';
  end if;

  if not exists (select 1 from public.patients pt where pt.id = p_patient_id) then
    raise exception 'patient not found';
  end if;

  if p_encounter_id is not null then
    if not exists (
      select 1
      from public.opd_encounters e
      where e.id = p_encounter_id
        and e.patient_id = p_patient_id
        and e.hospital_id = v_hospital
    ) then
      raise exception 'encounter does not match patient or hospital';
    end if;
  end if;

  if p_coverage_id is not null then
    if not exists (
      select 1
      from public.patient_insurance_coverage pic
      where pic.id = p_coverage_id
        and pic.patient_id = p_patient_id
        and pic.hospital_id = v_hospital
    ) then
      raise exception 'coverage does not match patient or hospital';
    end if;
  end if;

  if p_preauth_id is null then
    insert into public.insurance_preauths (
      hospital_id,
      patient_id,
      encounter_id,
      insurance_company_id,
      patient_insurance_coverage_id,
      requested_amount,
      estimated_amount,
      procedures_json,
      diagnosis_codes_json,
      clinical_summary,
      status,
      procedure_summary,
      submitted_at
    )
    values (
      v_hospital,
      p_patient_id,
      p_encounter_id,
      p_insurance_company_id,
      p_coverage_id,
      v_amt,
      v_amt,
      v_proc,
      v_dx,
      v_summary,
      'draft',
      left(v_summary, 2000),
      timezone('utc', now())
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.insurance_preauths p
  set
    patient_id = p_patient_id,
    encounter_id = p_encounter_id,
    insurance_company_id = p_insurance_company_id,
    patient_insurance_coverage_id = p_coverage_id,
    requested_amount = v_amt,
    estimated_amount = v_amt,
    procedures_json = v_proc,
    diagnosis_codes_json = v_dx,
    clinical_summary = v_summary,
    procedure_summary = left(v_summary, 2000),
    status = case when p.status = 'submitted' or p.status = 'in_review' or p.status = 'approved' then p.status else 'draft' end,
    updated_at = timezone('utc', now())
  where p.id = p_preauth_id
    and p.hospital_id = v_hospital;

  if not found then
    raise exception 'preauth not found or forbidden';
  end if;

  return p_preauth_id;
end;
$fn$;

comment on function public.upsert_preauth_request(uuid, uuid, uuid, uuid, uuid, numeric, jsonb, jsonb, text) is
  'Insert or update preauth as draft; preserves submitted+ status on update.';

revoke all on function public.upsert_preauth_request(uuid, uuid, uuid, uuid, uuid, numeric, jsonb, jsonb, text) from public;
grant execute on function public.upsert_preauth_request(uuid, uuid, uuid, uuid, uuid, numeric, jsonb, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- submit_preauth_request(p_id uuid)
-- ---------------------------------------------------------------------------

create or replace function public.submit_preauth_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
begin
  if p_id is null then
    raise exception 'preauth id required';
  end if;

  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  update public.insurance_preauths p
  set
    status = 'submitted',
    submitted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where p.id = p_id
    and p.hospital_id = v_hospital
    and p.status = 'draft';

  if not found then
    raise exception 'preauth not found, not draft, or forbidden';
  end if;
end;
$fn$;

comment on function public.submit_preauth_request(uuid) is
  'Move draft preauth to submitted for payer workflow.';

revoke all on function public.submit_preauth_request(uuid) from public;
grant execute on function public.submit_preauth_request(uuid) to authenticated, service_role;
