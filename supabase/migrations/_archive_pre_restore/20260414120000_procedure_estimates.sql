-- Procedure estimates (IPD surgery billing) + wallet deposit linkage.

-- ---------------------------------------------------------------------------
-- Optional: who recorded the wallet transaction (practitioner row)
-- ---------------------------------------------------------------------------
alter table public.wallet_transactions
  add column if not exists performed_by uuid references public.practitioners (id) on delete set null;

comment on column public.wallet_transactions.performed_by is
  'Practitioner who recorded the payment (optional; complements created_by auth user).';

-- ---------------------------------------------------------------------------
-- procedure_estimates
-- ---------------------------------------------------------------------------
create table if not exists public.procedure_estimates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  ot_surgery_id uuid references public.ot_surgeries (id) on delete set null,
  estimate_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'presented', 'accepted', 'declined', 'superseded')),
  line_items jsonb not null default '[]'::jsonb,
  estimated_total numeric(14, 2) not null default 0,
  deposit_requested numeric(14, 2) not null default 0,
  deposit_collected numeric(14, 2) not null default 0,
  notes text,
  presented_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name text,
  accepted_by_relation text
    check (
      accepted_by_relation is null
      or accepted_by_relation in ('self', 'spouse', 'parent', 'child', 'guardian')
    ),
  declined_at timestamptz,
  actual_invoice_id uuid references public.invoices (id) on delete set null,
  variance_amount numeric(14, 2),
  superseded_by_id uuid references public.procedure_estimates (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists procedure_estimates_hospital_estimate_number_uq
  on public.procedure_estimates (hospital_id, estimate_number);

create index if not exists procedure_estimates_admission_created_idx
  on public.procedure_estimates (admission_id, created_at desc);

create index if not exists procedure_estimates_patient_created_idx
  on public.procedure_estimates (patient_id, created_at desc);

create index if not exists procedure_estimates_hospital_status_idx
  on public.procedure_estimates (hospital_id, status);

comment on table public.procedure_estimates is
  'Per-admission procedure fee estimate with JSON line_items; supports deposit tracking and supersede chain.';

-- Auto estimate_number: PE-YYYY-NNNNNN per hospital per calendar year (UTC)
create or replace function public.trg_set_procedure_estimate_number()
returns trigger
language plpgsql
as $fn$
declare
  next_n int;
  y text;
begin
  if new.estimate_number is not null and btrim(new.estimate_number) <> '' then
    return new;
  end if;
  y := to_char(timezone('utc', coalesce(new.created_at, now())), 'YYYY');
  select coalesce(max(split_part(e.estimate_number, '-', 3)::int), 0) + 1
  into next_n
  from public.procedure_estimates e
  where e.hospital_id = new.hospital_id
    and e.estimate_number ~ ('^PE-' || y || '-[0-9]+$');

  new.estimate_number := 'PE-' || y || '-' || lpad(next_n::text, 6, '0');
  return new;
end;
$fn$;

drop trigger if exists trg_procedure_estimates_number on public.procedure_estimates;
create trigger trg_procedure_estimates_number
  before insert on public.procedure_estimates
  for each row
  execute function public.trg_set_procedure_estimate_number();

create or replace function public.trg_procedure_estimates_touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$fn$;

drop trigger if exists trg_procedure_estimates_updated on public.procedure_estimates;
create trigger trg_procedure_estimates_updated
  before update on public.procedure_estimates
  for each row
  execute function public.trg_procedure_estimates_touch_updated_at();

alter table public.procedure_estimates enable row level security;

drop policy if exists procedure_estimates_select_practitioner_hospital on public.procedure_estimates;
create policy procedure_estimates_select_practitioner_hospital
  on public.procedure_estimates for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = procedure_estimates.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists procedure_estimates_insert_practitioner_hospital on public.procedure_estimates;
create policy procedure_estimates_insert_practitioner_hospital
  on public.procedure_estimates for insert to authenticated
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = procedure_estimates.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists procedure_estimates_update_practitioner_hospital on public.procedure_estimates;
create policy procedure_estimates_update_practitioner_hospital
  on public.procedure_estimates for update to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = procedure_estimates.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = procedure_estimates.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.procedure_estimates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_procedure_estimate_deposit
-- ---------------------------------------------------------------------------
create or replace function public.record_procedure_estimate_deposit(
  p_estimate_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_performed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pe public.procedure_estimates%rowtype;
  v_wallet numeric(14, 2);
  v_dep_collected numeric(14, 2);
begin
  if p_estimate_id is null then
    raise exception 'p_estimate_id required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if p_payment_method is null
    or p_payment_method not in ('cash', 'upi', 'card', 'netbanking', 'cheque') then
    raise exception 'invalid payment_method';
  end if;

  select * into v_pe from public.procedure_estimates where id = p_estimate_id;
  if not found then
    raise exception 'estimate not found';
  end if;

  perform public._billing_assert_hospital_access(v_pe.hospital_id);

  insert into public.wallet_transactions (
    patient_id,
    hospital_id,
    type,
    reference_type,
    amount,
    payment_method,
    reference_number,
    created_by,
    performed_by
  )
  values (
    v_pe.patient_id,
    v_pe.hospital_id,
    'credit',
    'advance_payment',
    p_amount,
    p_payment_method,
    nullif(trim(coalesce(p_reference_number, '')), ''),
    auth.uid(),
    p_performed_by
  );

  insert into public.patient_wallet (patient_id, hospital_id, balance)
  values (v_pe.patient_id, v_pe.hospital_id, p_amount)
  on conflict (patient_id, hospital_id)
  do update set
    balance = public.patient_wallet.balance + excluded.balance,
    updated_at = timezone('utc', now())
  returning balance into v_wallet;

  update public.procedure_estimates
  set deposit_collected = deposit_collected + p_amount
  where id = p_estimate_id
  returning deposit_collected into v_dep_collected;

  return jsonb_build_object(
    'wallet_balance', v_wallet,
    'deposit_collected', v_dep_collected
  );
end;
$fn$;

revoke all on function public.record_procedure_estimate_deposit(uuid, numeric, text, text, uuid) from public;
grant execute on function public.record_procedure_estimate_deposit(uuid, numeric, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- supersede_procedure_estimate
-- ---------------------------------------------------------------------------
create or replace function public.supersede_procedure_estimate(p_estimate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.procedure_estimates%rowtype;
  v_new_id uuid;
begin
  if p_estimate_id is null then
    raise exception 'p_estimate_id required';
  end if;

  select * into v_old from public.procedure_estimates where id = p_estimate_id;
  if not found then
    raise exception 'estimate not found';
  end if;

  perform public._billing_assert_hospital_access(v_old.hospital_id);

  if v_old.status = 'superseded' then
    raise exception 'estimate already superseded';
  end if;

  insert into public.procedure_estimates (
    hospital_id,
    admission_id,
    patient_id,
    ot_surgery_id,
    estimate_number,
    status,
    line_items,
    estimated_total,
    deposit_requested,
    deposit_collected,
    notes
  )
  values (
    v_old.hospital_id,
    v_old.admission_id,
    v_old.patient_id,
    v_old.ot_surgery_id,
    '', -- trigger fills
    'draft',
    v_old.line_items,
    v_old.estimated_total,
    v_old.deposit_requested,
    v_old.deposit_collected,
    v_old.notes
  )
  returning id into v_new_id;

  update public.procedure_estimates
  set
    status = 'superseded',
    superseded_by_id = v_new_id
  where id = p_estimate_id;

  return v_new_id;
end;
$fn$;

revoke all on function public.supersede_procedure_estimate(uuid) from public;
grant execute on function public.supersede_procedure_estimate(uuid) to authenticated, service_role;
