-- Reception-side appointment booking.
--
-- Until now the only way a future appointment could come into existence was
-- schedule_follow_up(), called from inside an open encounter. That covers "come
-- back in six weeks" and nothing else: a patient who telephones the desk cannot
-- be booked at all. Every other part of 2.5 was built on top of a table that had
-- exactly one writer -- which is why booking_source has never held anything but
-- 'walk_in', and why the WhatsApp reminder cron has never had a row to act on.
--
-- These four functions give the desk the missing verbs. They deliberately reuse
-- the filters that find_appointment_for_patient() and due_appointment_reminders()
-- already apply (booking_source in ('booked','follow_up_auto'), status not in
-- cancelled/completed/no_show), so a booking made here is visible to the day
-- schedule, the Expected-today panel and the reminder job without any of them
-- changing.

alter table public.appointments
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz;

comment on column public.appointments.cancellation_reason is
  'Free text from whoever cancelled. Kept because "no_show" and "patient rescheduled" are clinically different and the status column cannot tell them apart.';


-- Book a patient for a future date.
--
-- Booking the same patient twice for one day is almost always a desk error rather
-- than an intention, so a second call updates the live booking instead of creating
-- a rival one. The caller can tell which happened from `created`.
create or replace function public.book_appointment(
  p_patient_id  uuid,
  p_date        date,
  p_time        time without time zone default null,
  p_doctor_id   uuid default null,
  p_visit_type  text default 'new',
  p_notes       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hospital uuid;
  v_doc      uuid;
  v_type     text := coalesce(nullif(btrim(p_visit_type), ''), 'new');
  v_appt_id  uuid;
  v_created  boolean := false;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  select hospital_id into v_hospital from patients where id = p_patient_id;
  if v_hospital is null then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  if p_date is null then
    raise exception 'An appointment date is required' using errcode = '22004';
  end if;
  if p_date < current_date then
    raise exception 'That date is in the past' using errcode = '22007';
  end if;
  if v_type not in ('new', 'follow_up', 'review', 'procedure') then
    raise exception 'Unknown visit type %', v_type using errcode = '22023';
  end if;

  -- Accept either a practitioners.id or the auth user id behind it, the way
  -- schedule_follow_up and check_in_appointment both do.
  if p_doctor_id is not null then
    perform public._assert_hospital_scope('practitioner', p_doctor_id);
    select p.id into v_doc from practitioners p
     where p.id = p_doctor_id or p.user_id = p_doctor_id limit 1;
    if v_doc is null then
      raise exception 'Doctor not found' using errcode = 'P0002';
    end if;
  end if;

  select id into v_appt_id
    from appointments
   where patient_id = p_patient_id
     and appointment_date = p_date
     and coalesce(booking_source, 'walk_in') in ('booked', 'follow_up_auto')
     and coalesce(status, '') not in ('cancelled', 'completed', 'no_show')
   order by booked_at nulls last
   limit 1;

  if v_appt_id is null then
    insert into appointments (hospital_id, patient_id, doctor_id, assigned_doctor_id,
                              appointment_date, scheduled_time, start_time, status,
                              visit_type, booking_source, booked_at, chief_complaint)
    values (v_hospital, p_patient_id, v_doc, v_doc,
            p_date, p_time, p_time, 'scheduled',
            v_type, 'booked', now(), nullif(btrim(p_notes), ''))
    returning id into v_appt_id;
    v_created := true;
  else
    update appointments
       set scheduled_time     = coalesce(p_time, scheduled_time),
           start_time         = coalesce(p_time, start_time),
           doctor_id          = coalesce(v_doc, doctor_id),
           assigned_doctor_id = coalesce(v_doc, assigned_doctor_id),
           visit_type         = v_type,
           chief_complaint    = coalesce(nullif(btrim(p_notes), ''), chief_complaint),
           booked_at          = coalesce(booked_at, now())
     where id = v_appt_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'created', v_created,
    'appointment_id', v_appt_id,
    'appointment_date', p_date,
    'scheduled_time', p_time,
    'visit_type', v_type,
    'doctor_id', v_doc);
end;
$function$;


-- Move a booking. Refuses once the patient has arrived, because at that point the
-- reception_queue row and its token are the record of the visit and moving the
-- appointment under them would leave the two disagreeing.
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_date           date,
  p_time           time without time zone default null,
  p_doctor_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_appt appointments;
  v_doc  uuid;
begin
  perform public._assert_hospital_scope('appointment', p_appointment_id);

  select * into v_appt from appointments where id = p_appointment_id;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from reception_queue where appointment_id = p_appointment_id) then
    raise exception 'That patient has already checked in' using errcode = '22023';
  end if;
  if coalesce(v_appt.status, '') in ('cancelled', 'completed') then
    raise exception 'That appointment is % and cannot be moved', v_appt.status
      using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'A new date is required' using errcode = '22004';
  end if;
  if p_date < current_date then
    raise exception 'That date is in the past' using errcode = '22007';
  end if;

  if p_doctor_id is not null then
    perform public._assert_hospital_scope('practitioner', p_doctor_id);
    select p.id into v_doc from practitioners p
     where p.id = p_doctor_id or p.user_id = p_doctor_id limit 1;
  end if;

  update appointments
     set appointment_date   = p_date,
         scheduled_time     = p_time,
         start_time         = p_time,
         doctor_id          = coalesce(v_doc, doctor_id),
         assigned_doctor_id = coalesce(v_doc, assigned_doctor_id),
         status             = 'scheduled',
         cancellation_reason = null,
         cancelled_at       = null
   where id = p_appointment_id;

  -- A follow-up carries the encounter's follow_up_date with it, or the encounter
  -- would keep advertising a date the appointment no longer has.
  if v_appt.parent_encounter_id is not null then
    update opd_encounters set follow_up_date = p_date where id = v_appt.parent_encounter_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'appointment_date', p_date,
    'scheduled_time', p_time);
end;
$function$;


-- Cancel a booking. Nothing is deleted: a cancelled appointment is evidence that
-- the visit was arranged and did not happen, which matters for both the audit
-- trail and the no-show conversation.
create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_reason         text default null,
  p_no_show        boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_appt appointments;
begin
  perform public._assert_hospital_scope('appointment', p_appointment_id);

  select * into v_appt from appointments where id = p_appointment_id;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from reception_queue where appointment_id = p_appointment_id) then
    raise exception 'That patient has already checked in' using errcode = '22023';
  end if;
  if coalesce(v_appt.status, '') = 'completed' then
    raise exception 'That appointment is already completed' using errcode = '22023';
  end if;

  update appointments
     set status              = case when p_no_show then 'no_show' else 'cancelled' end,
         cancellation_reason = nullif(btrim(p_reason), ''),
         cancelled_at        = now()
   where id = p_appointment_id;

  if v_appt.parent_encounter_id is not null then
    update opd_encounters set follow_up_date = null where id = v_appt.parent_encounter_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'status', case when p_no_show then 'no_show' else 'cancelled' end);
end;
$function$;


-- The desk's forward view: everything booked between two dates, with enough on
-- each row to act on it without a second round trip.
create or replace function public.upcoming_appointments(
  p_from      date default null,
  p_days      integer default 14,
  p_doctor_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_from date := coalesce(p_from, current_date);
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 120);
  v_doc  uuid;
  v json;
begin
  if p_doctor_id is not null then
    select p.id into v_doc from practitioners p
     where p.id = p_doctor_id or p.user_id = p_doctor_id limit 1;
  end if;

  select json_agg(row_to_json(a)
                  order by a.appointment_date, a.scheduled_time nulls last) into v
  from (
    select ap.id              as appointment_id,
           ap.appointment_date,
           ap.scheduled_time,
           ap.status,
           ap.visit_type,
           ap.booking_source,
           ap.chief_complaint,
           ap.patient_id,
           pt.full_name       as patient_name,
           pt.phone           as patient_phone,
           ap.doctor_id,
           pr.full_name       as doctor_name,
           ap.parent_encounter_id,
           exists (select 1 from reception_queue q where q.appointment_id = ap.id) as already_checked_in,
           exists (select 1 from appointment_reminders r where r.appointment_id = ap.id
                     and coalesce(r.status, '') = 'sent') as reminder_sent
      from appointments ap
      join patients pt on pt.id = ap.patient_id
      left join practitioners pr on pr.id = coalesce(ap.assigned_doctor_id, ap.doctor_id)
     where ap.hospital_id = auth_hospital_id()
       and ap.appointment_date between v_from and v_from + v_days
       and coalesce(ap.booking_source, 'walk_in') in ('booked', 'follow_up_auto')
       and coalesce(ap.status, '') not in ('cancelled', 'completed')
       and (v_doc is null or coalesce(ap.assigned_doctor_id, ap.doctor_id) = v_doc)
  ) a;

  return coalesce(v, '[]'::json);
end;
$function$;


revoke all on function public.book_appointment(uuid, date, time without time zone, uuid, text, text) from public, anon;
revoke all on function public.reschedule_appointment(uuid, date, time without time zone, uuid) from public, anon;
revoke all on function public.cancel_appointment(uuid, text, boolean) from public, anon;
revoke all on function public.upcoming_appointments(date, integer, uuid) from public, anon;

grant execute on function public.book_appointment(uuid, date, time without time zone, uuid, text, text) to authenticated, service_role;
grant execute on function public.reschedule_appointment(uuid, date, time without time zone, uuid) to authenticated, service_role;
grant execute on function public.cancel_appointment(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.upcoming_appointments(date, integer, uuid) to authenticated, service_role;


-- Unrelated to booking, but flagged by the security advisor in the same pass:
-- icd10_lexeme_df is a materialized view, so RLS does not apply to it and
-- PostgREST was serving it to any signed-in user. It holds nothing sensitive --
-- document frequencies for ICD-10 wording -- but it is internal to the search
-- ranking and has no business being an API surface.
revoke all on public.icd10_lexeme_df from anon, authenticated;
