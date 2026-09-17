-- OPD lab "Mark Paid" at reception: investigations must be billing_status = 'paid' so DB can advance to pending_collection for the lab portal.

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
  v_src        text;
  v_service    text;
  v_inv_id     uuid;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be non-negative';
  end if;

  if v_method not in ('cash', 'upi', 'card', 'netbanking', 'cheque', 'insurance', 'other') then
    raise exception 'invalid payment_method: %', v_method;
  end if;

  select source_type, source_id into v_src, v_inv_id
  from public.charge_items
  where id = p_charge_item_id
    and hospital_id = p_hospital_id;

  v_service := case coalesce(v_src, '')
    when 'queue' then 'consultation'
    when 'service_request' then 'lab'
    else 'lab'
  end;

  update public.charge_items
  set status = 'billed'
  where id = p_charge_item_id
    and hospital_id = p_hospital_id;

  if not found then
    raise exception 'charge item not found or already billed';
  end if;

  if v_inv_id is not null and coalesce(v_src, '') = 'service_request' then
    update public.investigations
    set billing_status = 'paid'
    where id = v_inv_id;
  end if;

  insert into public.payments (
    hospital_id,
    patient_id,
    amount,
    payment_method,
    status,
    notes,
    collected_by,
    payment_date,
    metadata
  ) values (
    p_hospital_id,
    p_patient_id,
    coalesce(p_amount, 0),
    v_method,
    'confirmed',
    nullif(trim(coalesce(p_notes, '')), ''),
    p_collected_by,
    timezone('utc', now()),
    jsonb_build_object('service', v_service)
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$fn$;

comment on function public.record_lab_payment(uuid, uuid, uuid, numeric, text, uuid, text) is
  'Mark charge_item billed, set linked OPD investigation billing_status to paid, insert payment; reception pending lab + consultation fee collection.';
