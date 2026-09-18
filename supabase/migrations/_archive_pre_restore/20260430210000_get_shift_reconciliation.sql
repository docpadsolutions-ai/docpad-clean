-- Shift-end reconciliation RPC + reception_queue payment override columns + payment metadata for lab vs consultation.

alter table public.payments
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.reception_queue
  add column if not exists payment_override boolean not null default false;

alter table public.reception_queue
  add column if not exists payment_override_by uuid references public.practitioners (id) on delete set null;

alter table public.reception_queue
  add column if not exists payment_override_at timestamptz;

alter table public.reception_queue
  add column if not exists queue_date date;

alter table public.reception_queue
  add column if not exists payment_collected boolean not null default false;

create index if not exists reception_queue_hospital_queue_date_idx
  on public.reception_queue (hospital_id, queue_date)
  where queue_date is not null;

-- ---------------------------------------------------------------------------
-- record_lab_payment: tag payment metadata from charge_items.source_type
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
  v_src        text;
  v_service    text;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be non-negative';
  end if;

  if v_method not in ('cash', 'upi', 'card', 'netbanking', 'cheque', 'insurance', 'other') then
    raise exception 'invalid payment_method: %', v_method;
  end if;

  select source_type into v_src
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

-- ---------------------------------------------------------------------------
-- get_shift_reconciliation: JSON for reception shift report UI
-- ---------------------------------------------------------------------------
create or replace function public.get_shift_reconciliation(
  p_hospital_id uuid,
  p_date text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date := p_date::date;
  v_summary jsonb;
  v_transactions jsonb;
  v_overrides jsonb;
begin
  select jsonb_build_object(
    'total_collected', coalesce(sum(p.amount), 0),
    'cash', coalesce(sum(case when p.payment_method = 'cash' then p.amount else 0 end), 0),
    'upi', coalesce(sum(case when p.payment_method = 'upi' then p.amount else 0 end), 0),
    'card', coalesce(sum(case when p.payment_method = 'card' then p.amount else 0 end), 0)
  )
  into v_summary
  from public.payments p
  where p.hospital_id = p_hospital_id
    and p.status = 'confirmed'
    and (timezone('UTC', p.payment_date))::date = v_day;

  select coalesce(
    jsonb_agg(row_data ORDER BY sort_ts),
    '[]'::jsonb
  )
  into v_transactions
  from (
    select
      p.payment_date as sort_ts,
      jsonb_build_object(
        'time', p.payment_date,
        'patient_name', coalesce(pt.full_name, '—'),
        'patient', coalesce(pt.full_name, '—'),
        'type', case
          when coalesce(p.metadata->>'service', '') = 'lab' then 'lab'
          when coalesce(p.metadata->>'service', '') = 'consultation' then 'consultation'
          when p.invoice_id is not null then 'consultation'
          else 'lab'
        end,
        'amount', p.amount,
        'method', p.payment_method,
        'collected_by', coalesce(pr.full_name, pr2.full_name, '—')
      ) as row_data
    from public.payments p
    left join public.patients pt on pt.id = p.patient_id
    left join public.practitioners pr on pr.id = p.collected_by
    left join public.practitioners pr2 on pr2.user_id = p.collected_by
    where p.hospital_id = p_hospital_id
      and p.status = 'confirmed'
      and (timezone('UTC', p.payment_date))::date = v_day
  ) q;

  select coalesce(
    jsonb_agg(row_data ORDER BY sort_ts),
    '[]'::jsonb
  )
  into v_overrides
  from (
    select
      coalesce(rq.payment_override_at, rq.created_at) as sort_ts,
      jsonb_build_object(
        'patient_name', coalesce(p.full_name, '—'),
        'patient', coalesce(p.full_name, '—'),
        'token', coalesce(
          nullif(trim(rq.token), ''),
          case
            when rq.token_prefix is not null and rq.token_number is not null then
              trim(rq.token_prefix) || '-' || lpad(rq.token_number::text, 3, '0')
            else '—'
          end
        ),
        'authorised_by', coalesce(auth.full_name, '—'),
        'authorised_by_name', coalesce(auth.full_name, '—'),
        'time', coalesce(rq.payment_override_at, rq.created_at)
      ) as row_data
    from public.reception_queue rq
    inner join public.patients p on p.id = rq.patient_id
    left join public.practitioners auth on auth.id = rq.payment_override_by
    where rq.hospital_id = p_hospital_id
      and coalesce(rq.payment_override, false) = true
      and (
        rq.queue_date = v_day
        or (
          rq.queue_date is null
          and (timezone('UTC', rq.created_at))::date = v_day
        )
      )
  ) o;

  return jsonb_build_object(
    'summary', coalesce(v_summary, jsonb_build_object(
      'total_collected', 0,
      'cash', 0,
      'upi', 0,
      'card', 0
    )),
    'transactions', coalesce(v_transactions, '[]'::jsonb),
    'overrides', coalesce(v_overrides, '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.get_shift_reconciliation(uuid, text) from public;
grant execute on function public.get_shift_reconciliation(uuid, text) to authenticated, service_role;

comment on function public.get_shift_reconciliation(uuid, text) is
  'End-of-shift cash reconciliation: payments summary, transaction lines, and payment overrides for a hospital day (UTC date).';
