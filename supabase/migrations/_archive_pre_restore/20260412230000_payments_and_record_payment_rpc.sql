-- Payments ledger + RPC for invoice payment recording (used by billing UI).

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  invoice_id uuid references public.invoices (id) on delete set null,
  amount numeric(14, 2) not null,
  payment_method text not null
    check (
      payment_method in ('cash', 'upi', 'card', 'netbanking', 'cheque', 'insurance', 'other')
    ),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'voided', 'pending')),
  payment_date timestamptz not null default (timezone('utc', now())),
  reference_number text,
  notes text,
  collected_by uuid,
  created_at timestamptz not null default (timezone('utc', now()))
);

create index if not exists payments_hospital_payment_date_idx
  on public.payments (hospital_id, payment_date desc);

create index if not exists payments_invoice_id_idx
  on public.payments (invoice_id);

grant select, insert, update, delete on public.payments to authenticated, service_role;

create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_notes text,
  p_collected_by uuid
)
returns table (balance_due numeric, amount_paid numeric)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital uuid;
  v_inv record;
  v_collector uuid := coalesce(p_collected_by, auth.uid());
  v_prev_paid numeric;
  v_gross numeric;
  v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if p_payment_method is null
    or p_payment_method not in ('cash', 'upi', 'card', 'netbanking', 'cheque') then
    raise exception 'invalid payment_method';
  end if;

  select pr.hospital_id
  into v_hospital
  from public.practitioners pr
  where pr.user_id = auth.uid() or pr.id = auth.uid()
  limit 1;

  if v_hospital is null then
    raise exception 'no practitioner context for current user';
  end if;

  select i.*
  into v_inv
  from public.invoices i
  where i.id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  if v_inv.hospital_id is distinct from v_hospital then
    raise exception 'forbidden';
  end if;

  v_prev_paid := coalesce(v_inv.amount_paid, 0);
  v_gross := coalesce(v_inv.total_gross, 0);
  v_balance := coalesce(v_inv.balance_due, greatest(0, v_gross - v_prev_paid));

  if p_amount > v_balance + 0.0001 then
    raise exception 'amount exceeds balance due';
  end if;

  insert into public.payments (
    hospital_id,
    invoice_id,
    amount,
    payment_method,
    status,
    reference_number,
    notes,
    collected_by
  )
  values (
    v_inv.hospital_id,
    p_invoice_id,
    p_amount,
    p_payment_method,
    'confirmed',
    nullif(trim(coalesce(p_reference_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_collector
  );

  update public.invoices i
  set
    amount_paid = coalesce(i.amount_paid, 0) + p_amount,
    balance_due = greatest(
      0,
      coalesce(i.total_gross, 0) - (coalesce(i.amount_paid, 0) + p_amount)
    ),
    updated_at = timezone('utc', now())
  where i.id = p_invoice_id;

  return query
  select i.balance_due, i.amount_paid
  from public.invoices i
  where i.id = p_invoice_id;
end;
$fn$;

revoke all on function public.record_payment(uuid, numeric, text, text, text, uuid) from public;
grant execute on function public.record_payment(uuid, numeric, text, text, text, uuid) to authenticated, service_role;

comment on function public.record_payment(uuid, numeric, text, text, text, uuid) is
  'Insert confirmed payment and update invoice amount_paid / balance_due; scoped to practitioner hospital.';
