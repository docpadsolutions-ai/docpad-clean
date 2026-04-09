-- No-show tracking + explicit registration time on reception queue.

alter table public.reception_queue
  add column if not exists no_show_marked_by uuid,
  add column if not exists no_show_marked_at timestamptz,
  add column if not exists registered_at timestamptz;

update public.reception_queue
set registered_at = coalesce(registered_at, created_at)
where registered_at is null;

alter table public.reception_queue
  alter column registered_at set default now();

alter table public.reception_queue
  alter column registered_at set not null;

comment on column public.reception_queue.no_show_marked_by is 'Supabase auth user id (auth.users) who marked no-show.';
comment on column public.reception_queue.no_show_marked_at is 'When the row was marked no-show.';
comment on column public.reception_queue.registered_at is 'When the patient was registered into the queue (eligibility for no-show timer).';

-- Expose in today view for clients that need audit fields
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
  rq.registered_at,
  rq.no_show_marked_by,
  rq.no_show_marked_at,
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
