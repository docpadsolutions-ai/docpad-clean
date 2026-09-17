-- OPD lab payment collection: add patient_id to payments and create record_lab_payment RPC.

-- ---------------------------------------------------------------------------
-- payments: add patient_id for direct-pay rows (no invoice)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists patient_id uuid references public.patients (id) on delete set null;

create index if not exists payments_hospital_patient_idx
  on public.payments (hospital_id, patient_id)
  where patient_id is not null;

-- ---------------------------------------------------------------------------
-- record_lab_payment: mark an OPD charge_item billed and write a payment row
-- ---------------------------------------------------------------------------
create or replace function public.record_lab_payment(
  p_charge_item_id   uuid,
  p_hospital_id      uuid,
  p_patient_id       uuid,
  p_amount           numeric,
  p_payment_method   text,
  p_collected_by     uuid,
  p_notes            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_payment_id uuid;
  v_method     text := lower(trim(coalesce(p_payment_method, 'cash')));
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be non-negative';
  end if;

  if v_method not in ('cash', 'upi', 'card', 'netbanking', 'cheque', 'insurance', 'other') then
    raise exception 'invalid payment_method: %', v_method;
  end if;

  update public.charge_items
  set status = 'billed'
  where id = p_charge_item_id
    and hospital_id = p_hospital_id;

  if not found then
    raise exception 'charge item not found or already billed';
  end if;

  insert into public.payments (
    hospital_id,
    patient_id,
    amount,
    payment_method,
    status,
    notes,
    collected_by,
    payment_date
  ) values (
    p_hospital_id,
    p_patient_id,
    coalesce(p_amount, 0),
    v_method,
    'confirmed',
    nullif(trim(coalesce(p_notes, '')), ''),
    p_collected_by,
    timezone('utc', now())
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$fn$;

revoke all on function public.record_lab_payment(uuid, uuid, uuid, numeric, text, uuid, text) from public;
grant execute on function public.record_lab_payment(uuid, uuid, uuid, numeric, text, uuid, text) to authenticated, service_role;

comment on function public.record_lab_payment(uuid, uuid, uuid, numeric, text, uuid, text) is
  'Mark an OPD charge_item as billed and insert a confirmed payment row; used by reception pending lab payments UI.';
