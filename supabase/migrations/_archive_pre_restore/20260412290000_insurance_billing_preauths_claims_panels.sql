-- Insurance billing: preauthorizations, claims, corporate panels + dashboard RPCs.

-- ---------------------------------------------------------------------------
-- insurance_preauths
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_preauths (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete restrict,
  insurance_company_id uuid references public.insurance_companies (id) on delete set null,
  requested_amount numeric(14, 2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'in_review', 'approved', 'rejected', 'expired')),
  procedure_summary text,
  submitted_at timestamptz not null default (timezone('utc', now())),
  resolved_at timestamptz,
  payer_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists insurance_preauths_hospital_status_idx
  on public.insurance_preauths (hospital_id, status, submitted_at desc);

-- ---------------------------------------------------------------------------
-- insurance_claims
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_claims (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete restrict,
  insurance_company_id uuid references public.insurance_companies (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  claim_number text not null,
  billed_amount numeric(14, 2) not null default 0,
  approved_amount numeric(14, 2) not null default 0,
  settled_amount numeric(14, 2) not null default 0,
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'submitted',
        'in_review',
        'approved',
        'rejected',
        'partial_settled',
        'settled'
      )
    ),
  submitted_at timestamptz default (timezone('utc', now())),
  settlement_due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insurance_claims_hospital_claim_number_key unique (hospital_id, claim_number)
);

create index if not exists insurance_claims_hospital_status_idx
  on public.insurance_claims (hospital_id, status);

-- ---------------------------------------------------------------------------
-- insurance_corporate_panels (corporate / TPA agreements)
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_corporate_panels (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  corporate_name text not null,
  agreement_reference text,
  credit_limit numeric(14, 2) not null default 0,
  utilized_amount numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists insurance_corporate_panels_hospital_idx
  on public.insurance_corporate_panels (hospital_id, is_active);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.insurance_preauths enable row level security;
alter table public.insurance_claims enable row level security;
alter table public.insurance_corporate_panels enable row level security;

-- Preauths
drop policy if exists "insurance_preauths_select" on public.insurance_preauths;
drop policy if exists "insurance_preauths_insert" on public.insurance_preauths;
drop policy if exists "insurance_preauths_update" on public.insurance_preauths;

create policy "insurance_preauths_select"
on public.insurance_preauths for select to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_preauths.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_preauths_insert"
on public.insurance_preauths for insert to authenticated
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_preauths.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_preauths_update"
on public.insurance_preauths for update to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_preauths.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_preauths.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

-- Claims
drop policy if exists "insurance_claims_select" on public.insurance_claims;
drop policy if exists "insurance_claims_insert" on public.insurance_claims;
drop policy if exists "insurance_claims_update" on public.insurance_claims;

create policy "insurance_claims_select"
on public.insurance_claims for select to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_claims.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_claims_insert"
on public.insurance_claims for insert to authenticated
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_claims.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_claims_update"
on public.insurance_claims for update to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_claims.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_claims.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

-- Panels
drop policy if exists "insurance_panels_select" on public.insurance_corporate_panels;
drop policy if exists "insurance_panels_insert" on public.insurance_corporate_panels;
drop policy if exists "insurance_panels_update" on public.insurance_corporate_panels;

create policy "insurance_panels_select"
on public.insurance_corporate_panels for select to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_corporate_panels.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_panels_insert"
on public.insurance_corporate_panels for insert to authenticated
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_corporate_panels.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "insurance_panels_update"
on public.insurance_corporate_panels for update to authenticated
using (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_corporate_panels.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1 from public.practitioners pr
    where pr.hospital_id = insurance_corporate_panels.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

grant select, insert, update, delete on public.insurance_preauths to authenticated, service_role;
grant select, insert, update, delete on public.insurance_claims to authenticated, service_role;
grant select, insert, update, delete on public.insurance_corporate_panels to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: hospital from session practitioner
-- ---------------------------------------------------------------------------

create or replace function public._insurance_billing_hospital_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v uuid;
begin
  select pr.hospital_id
  into v
  from public.practitioners pr
  where pr.user_id = auth.uid() or pr.id = auth.uid()
  limit 1;
  return v;
end;
$fn$;

revoke all on function public._insurance_billing_hospital_id() from public;
grant execute on function public._insurance_billing_hospital_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_pending_preauths()
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
    greatest(0, (timezone('utc', now())::date - (p.submitted_at at time zone 'utc')::date))::integer as days_pending
  from public.insurance_preauths p
  inner join public.patients pt on pt.id = p.patient_id
  left join public.insurance_companies ic on ic.id = p.insurance_company_id
  where p.hospital_id = v_hospital
    and p.status in ('pending', 'submitted', 'in_review')
  order by p.submitted_at asc;
end;
$fn$;

comment on function public.get_pending_preauths() is
  'Preauths awaiting payer decision (pending/submitted/in_review) for practitioner hospital.';

-- ---------------------------------------------------------------------------
-- get_claims_summary()
-- ---------------------------------------------------------------------------

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
    and c.status is distinct from 'draft'
  order by c.submitted_at desc nulls last, c.created_at desc;
end;
$fn$;

comment on function public.get_claims_summary() is
  'Non-draft insurance claims for practitioner hospital with patient name.';

-- ---------------------------------------------------------------------------
-- get_insurance_billing_kpis() — header cards (pending count, in review, settlement due)
-- ---------------------------------------------------------------------------

create or replace function public.get_insurance_billing_kpis()
returns table (
  pending_preauths_count bigint,
  claims_in_review_count bigint,
  settlement_due_total numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_pre bigint;
  v_rev bigint;
  v_due numeric;
begin
  v_hospital := public._insurance_billing_hospital_id();
  if v_hospital is null then
    raise exception 'no practitioner hospital for current user';
  end if;

  select count(*)::bigint
  into v_pre
  from public.insurance_preauths p
  where p.hospital_id = v_hospital
    and p.status in ('pending', 'submitted', 'in_review');

  select count(*)::bigint
  into v_rev
  from public.insurance_claims c
  where c.hospital_id = v_hospital
    and c.status = 'in_review';

  select coalesce(
    sum(greatest(0, c.approved_amount - coalesce(c.settled_amount, 0))),
    0
  )
  into v_due
  from public.insurance_claims c
  where c.hospital_id = v_hospital
    and c.status in ('approved', 'partial_settled')
    and c.approved_amount > coalesce(c.settled_amount, 0);

  return query select v_pre, v_rev, v_due;
end;
$fn$;

comment on function public.get_insurance_billing_kpis() is
  'Dashboard KPIs: open preauths, claims in_review, total unsettled approved amount.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.get_pending_preauths() from public;
revoke all on function public.get_claims_summary() from public;
revoke all on function public.get_insurance_billing_kpis() from public;

grant execute on function public.get_pending_preauths() to authenticated, service_role;
grant execute on function public.get_claims_summary() to authenticated, service_role;
grant execute on function public.get_insurance_billing_kpis() to authenticated, service_role;
