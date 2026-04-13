-- Reception patient billing: wallet, wallet transactions, billing summary RPC, void line, price update.

-- ---------------------------------------------------------------------------
-- charge_items: optional override reason (e.g. UNPRICED…)
-- ---------------------------------------------------------------------------
alter table public.charge_items
  add column if not exists override_reason text;

comment on column public.charge_items.override_reason is
  'When set (e.g. UNPRICED…), UI may prompt for unit price before billing.';

-- ---------------------------------------------------------------------------
-- invoice_line_items: void tracking
-- ---------------------------------------------------------------------------
alter table public.invoice_line_items
  add column if not exists voided_at timestamptz;

alter table public.invoice_line_items
  add column if not exists void_reason text;

alter table public.invoice_line_items
  add column if not exists void_cancelled_by uuid;

-- ---------------------------------------------------------------------------
-- patient_wallet
-- ---------------------------------------------------------------------------
create table if not exists public.patient_wallet (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  balance numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (patient_id, hospital_id)
);

create index if not exists patient_wallet_hospital_idx on public.patient_wallet (hospital_id);

-- ---------------------------------------------------------------------------
-- wallet_transactions
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('credit', 'debit')),
  reference_type text not null default 'advance_payment',
  amount numeric(14, 2) not null check (amount > 0),
  payment_method text
    check (
      payment_method is null
      or payment_method in ('cash', 'upi', 'card', 'netbanking', 'cheque', 'insurance', 'other')
    ),
  reference_number text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_patient_idx on public.wallet_transactions (patient_id, created_at desc);

alter table public.patient_wallet enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists patient_wallet_select on public.patient_wallet;
create policy patient_wallet_select
  on public.patient_wallet for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = patient_wallet.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

drop policy if exists patient_wallet_write on public.patient_wallet;
create policy patient_wallet_write
  on public.patient_wallet for all to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = patient_wallet.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = patient_wallet.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

drop policy if exists wallet_transactions_select on public.wallet_transactions;
create policy wallet_transactions_select
  on public.wallet_transactions for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = wallet_transactions.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

drop policy if exists wallet_transactions_insert on public.wallet_transactions;
create policy wallet_transactions_insert
  on public.wallet_transactions for insert to authenticated
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = wallet_transactions.hospital_id
        and (pr.user_id = auth.uid() or pr.id = auth.uid())
    )
  );

grant select, insert, update, delete on public.patient_wallet to authenticated, service_role;
grant select, insert on public.wallet_transactions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal: recompute invoice totals from non-void line nets
-- ---------------------------------------------------------------------------
create or replace function public._recalculate_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gross numeric(14, 2);
begin
  select coalesce(sum(case when li.voided_at is null then li.net_amount else 0 end), 0)
  into v_gross
  from public.invoice_line_items li
  where li.invoice_id = p_invoice_id;

  update public.invoices i
  set
    total_gross = v_gross,
    total_net = v_gross,
    balance_due = greatest(0, v_gross - coalesce(i.amount_paid, 0)),
    updated_at = timezone('utc', now())
  where i.id = p_invoice_id;
end;
$fn$;

revoke all on function public._recalculate_invoice_totals(uuid) from public;
grant execute on function public._recalculate_invoice_totals(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- get_patient_billing_summary
-- ---------------------------------------------------------------------------
create or replace function public.get_patient_billing_summary(
  p_hospital_id uuid,
  p_patient_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_wallet numeric(14, 2);
  v_out numeric(14, 2);
  v_invoices jsonb;
begin
  perform public._billing_assert_hospital_access(p_hospital_id);

  select coalesce(pw.balance, 0) into v_wallet
  from public.patient_wallet pw
  where pw.patient_id = p_patient_id and pw.hospital_id = p_hospital_id;

  if v_wallet is null then
    v_wallet := 0;
  end if;

  select coalesce(sum(i.balance_due), 0) into v_out
  from public.invoices i
  where i.patient_id = p_patient_id
    and i.hospital_id = p_hospital_id
    and coalesce(i.status, '') not in ('cancelled', 'voided');

  select coalesce(
    jsonb_agg(row_json order by sort_date desc nulls last),
    '[]'::jsonb
  )
  into v_invoices
  from (
    select
      i.invoice_date as sort_date,
      (
        to_jsonb(i)
        || jsonb_build_object(
          'line_items',
          coalesce((
            select jsonb_agg(
              (
                to_jsonb(li)
                || jsonb_build_object(
                  'charge_item',
                  jsonb_build_object(
                    'id', ci.id,
                    'unit_price_snapshot', ci.unit_price_snapshot,
                    'override_reason', ci.override_reason,
                    'display_label', ci.display_label
                  )
                )
              )
              order by li.line_number
            )
            from public.invoice_line_items li
            inner join public.charge_items ci on ci.id = li.charge_item_id
            where li.invoice_id = i.id
          ), '[]'::jsonb)
        )
      ) as row_json
    from public.invoices i
    where i.patient_id = p_patient_id
      and i.hospital_id = p_hospital_id
  ) q;

  return jsonb_build_object(
    'wallet_balance', v_wallet,
    'total_outstanding', coalesce(v_out, 0),
    'invoices', coalesce(v_invoices, '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.get_patient_billing_summary(uuid, uuid) from public;
grant execute on function public.get_patient_billing_summary(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- apply_advance_wallet_payment
-- ---------------------------------------------------------------------------
create or replace function public.apply_advance_wallet_payment(
  p_hospital_id uuid,
  p_patient_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_new_balance numeric(14, 2);
begin
  perform public._billing_assert_hospital_access(p_hospital_id);

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if p_payment_method is null
    or p_payment_method not in ('cash', 'upi', 'card', 'netbanking', 'cheque') then
    raise exception 'invalid payment_method';
  end if;

  insert into public.wallet_transactions (
    patient_id,
    hospital_id,
    type,
    reference_type,
    amount,
    payment_method,
    reference_number,
    created_by
  )
  values (
    p_patient_id,
    p_hospital_id,
    'credit',
    'advance_payment',
    p_amount,
    p_payment_method,
    nullif(trim(coalesce(p_reference_number, '')), ''),
    auth.uid()
  );

  insert into public.patient_wallet (patient_id, hospital_id, balance)
  values (p_patient_id, p_hospital_id, p_amount)
  on conflict (patient_id, hospital_id)
  do update set
    balance = public.patient_wallet.balance + excluded.balance,
    updated_at = timezone('utc', now())
  returning balance into v_new_balance;

  return v_new_balance;
end;
$fn$;

revoke all on function public.apply_advance_wallet_payment(uuid, uuid, numeric, text, text) from public;
grant execute on function public.apply_advance_wallet_payment(uuid, uuid, numeric, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- void_invoice_line_item
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice_line_item(
  p_line_item_id uuid,
  p_reason text,
  p_cancelled_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inv uuid;
  v_hospital uuid;
  v_ci uuid;
  v_label text;
begin
  if p_line_item_id is null then
    raise exception 'p_line_item_id required';
  end if;

  select li.invoice_id, inv.hospital_id, li.charge_item_id
  into v_inv, v_hospital, v_ci
  from public.invoice_line_items li
  inner join public.invoices inv on inv.id = li.invoice_id
  where li.id = p_line_item_id;

  if v_inv is null then
    raise exception 'line item not found';
  end if;

  perform public._billing_assert_hospital_access(v_hospital);

  update public.invoice_line_items li
  set
    voided_at = timezone('utc', now()),
    void_reason = nullif(trim(coalesce(p_reason, '')), ''),
    void_cancelled_by = p_cancelled_by,
    net_amount = 0,
    line_subtotal = 0
  where li.id = p_line_item_id;

  select coalesce(ci.display_label, '') into v_label
  from public.charge_items ci
  where ci.id = v_ci;

  if v_label not like '[VOIDED]%' then
    update public.charge_items
    set display_label = '[VOIDED] ' || v_label
    where id = v_ci;
  end if;

  perform public._recalculate_invoice_totals(v_inv);
end;
$fn$;

revoke all on function public.void_invoice_line_item(uuid, text, uuid) from public;
grant execute on function public.void_invoice_line_item(uuid, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_invoice_line_item_unit_price — update charge snapshot + line amounts + invoice
-- ---------------------------------------------------------------------------
create or replace function public.set_invoice_line_item_unit_price(
  p_line_item_id uuid,
  p_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inv uuid;
  v_hospital uuid;
  v_ci uuid;
  v_qty numeric(14, 4);
  v_disc numeric(14, 4);
  v_tax numeric(14, 4);
  v_sub numeric(14, 2);
  v_net numeric(14, 2);
begin
  if p_line_item_id is null or p_unit_price is null or p_unit_price < 0 then
    raise exception 'invalid arguments';
  end if;

  select
    li.invoice_id,
    li.charge_item_id,
    li.quantity,
    coalesce(li.discount_percent, 0),
    coalesce(li.tax_percent, 0),
    inv.hospital_id
  into v_inv, v_ci, v_qty, v_disc, v_tax, v_hospital
  from public.invoice_line_items li
  inner join public.invoices inv on inv.id = li.invoice_id
  where li.id = p_line_item_id;

  if v_inv is null then
    raise exception 'line item not found';
  end if;

  perform public._billing_assert_hospital_access(v_hospital);

  update public.charge_items
  set unit_price_snapshot = p_unit_price
  where id = v_ci;

  v_sub := round(
    v_qty * p_unit_price * (1 - v_disc / 100.0),
    2
  );
  v_net := round(
    v_qty * p_unit_price * (1 - v_disc / 100.0) * (1 + v_tax / 100.0),
    2
  );

  update public.invoice_line_items
  set
    unit_price = p_unit_price,
    line_subtotal = v_sub,
    net_amount = v_net
  where id = p_line_item_id;

  perform public._recalculate_invoice_totals(v_inv);
end;
$fn$;

revoke all on function public.set_invoice_line_item_unit_price(uuid, numeric) from public;
grant execute on function public.set_invoice_line_item_unit_price(uuid, numeric) to authenticated, service_role;

comment on function public.get_patient_billing_summary(uuid, uuid) is
  'Reception billing: wallet_balance, total_outstanding, invoices with line_items + charge_item metadata.';
