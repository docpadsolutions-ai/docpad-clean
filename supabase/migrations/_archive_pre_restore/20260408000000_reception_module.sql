-- Reception module: queue, OPD consultation billing, lab billing queue, fee master.
-- Safe to run if objects already exist in your project (uses IF NOT EXISTS / OR REPLACE where possible).

create table if not exists public.reception_queue (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.organizations (id) on delete set null,
  patient_id uuid not null references public.patients (id) on delete cascade,
  doctor_id uuid references public.practitioners (id) on delete set null,
  token text,
  queue_status text not null default 'registered',
  bill_status text,
  waiting_since timestamptz not null default now(),
  triage_bp text,
  triage_pulse text,
  triage_temp text,
  triage_spo2 text,
  triage_weight text,
  consultation_room text,
  opd_bill_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reception_queue_hospital_created_idx
  on public.reception_queue (hospital_id, created_at desc);

create index if not exists reception_queue_status_idx
  on public.reception_queue (queue_status);

create table if not exists public.opd_bills (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.organizations (id) on delete set null,
  patient_id uuid not null references public.patients (id) on delete cascade,
  doctor_id uuid references public.practitioners (id) on delete set null,
  reception_queue_id uuid references public.reception_queue (id) on delete set null,
  bill_type text not null default 'consultation',
  amount numeric(12, 2) not null,
  amount_paid numeric(12, 2) not null default 0,
  payment_mode text,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);

create table if not exists public.consultation_fee_master (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  doctor_id uuid not null references public.practitioners (id) on delete cascade,
  fee_amount numeric(12, 2) not null,
  effective_from date not null default (current_date),
  unique (hospital_id, doctor_id)
);

create table if not exists public.investigation_bills (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.organizations (id) on delete set null,
  patient_id uuid not null references public.patients (id) on delete cascade,
  investigation_id uuid,
  amount numeric(12, 2) not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.generate_daily_token(p_hospital_id uuid)
returns text
language sql
stable
as $$
  select lpad((count(*) + 1)::text, 3, '0')
  from public.reception_queue
  where hospital_id is not distinct from p_hospital_id
    and (created_at at time zone 'utc')::date = (timezone('utc', now()))::date;
$$;

comment on function public.generate_daily_token(uuid) is
  'Returns zero-padded numeric token for today per hospital (reception).';

-- Today's queue for reception dashboard (UTC date; adjust TZ in DB if needed)
create or replace view public.reception_today_queue as
select
  rq.id,
  rq.hospital_id,
  rq.patient_id,
  rq.doctor_id,
  rq.token,
  rq.queue_status,
  rq.bill_status,
  rq.waiting_since,
  rq.triage_bp,
  rq.triage_pulse,
  rq.triage_temp,
  rq.triage_spo2,
  rq.triage_weight,
  rq.consultation_room,
  rq.opd_bill_id,
  rq.created_at,
  rq.updated_at,
  p.full_name as patient_full_name,
  p.age_years as patient_age_years,
  p.sex as patient_sex,
  p.phone as patient_phone,
  p.docpad_id as patient_docpad_id,
  pr.full_name as doctor_name
from public.reception_queue rq
inner join public.patients p on p.id = rq.patient_id
left join public.practitioners pr on pr.id = rq.doctor_id
where (rq.created_at at time zone 'utc')::date = (timezone('utc', now()))::date;

-- Pending lab / investigation bills for reception
create or replace view public.reception_billing_queue as
select
  ib.id,
  ib.hospital_id,
  ib.patient_id,
  ib.investigation_id,
  ib.amount,
  ib.status,
  ib.created_at,
  p.full_name as patient_full_name,
  p.docpad_id as patient_docpad_id
from public.investigation_bills ib
inner join public.patients p on p.id = ib.patient_id
where ib.status in ('pending', 'billing_pending');

-- Enable RLS in production and add org-scoped policies; omitted here to avoid conflicting with existing projects.

grant select, insert, update, delete on public.reception_queue to authenticated, service_role;
grant select, insert, update, delete on public.opd_bills to authenticated, service_role;
grant select, insert, update, delete on public.consultation_fee_master to authenticated, service_role;
grant select, insert, update, delete on public.investigation_bills to authenticated, service_role;
grant select on public.reception_today_queue to authenticated, service_role;
grant select on public.reception_billing_queue to authenticated, service_role;
