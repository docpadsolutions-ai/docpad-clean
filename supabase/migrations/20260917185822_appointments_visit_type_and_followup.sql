-- NOTE: kept from the repo rather than restored from the database.
-- This migration was corrected in place after it was first applied, with
-- execute_sql rather than a new migration, so schema_migrations still holds the
-- original. The live database has the corrected version; this file is what
-- reproduces it. See scripts/restore-migration-files.mjs for the restore itself.

-- ============================================================================
-- SOW 2.5 — appointments, walk-ins and follow-up differentiation
--
-- Before this migration a walk-in and a pre-booked visit were the same thing:
-- reception created an `appointments` row at registration, so nothing recorded
-- whether the patient was expected. The follow-up field on an encounter wrote a
-- date onto opd_encounters and stopped there — it created no booking, so the
-- doctor's day never showed who was due back and nothing could be reminded.
--
-- This migration adds:
--   * appointments.visit_type / booking_source / parent_encounter_id
--   * opd_encounters.visit_type — new | scheduled_follow_up | unscheduled_return,
--     derived on insert and carried into the FHIR Encounter.type
--   * schedule_follow_up() / cancel_follow_up() — booking a real appointment
--     from inside the encounter, idempotent per encounter
--   * find_appointment_for_patient() / check_in_appointment() — reception
--     reconciles an arriving patient against their booking instead of opening a
--     second walk-in, and the day's token is allocated under a lock rather than
--     by a client-side "max + 1" that two desks can win at once
--   * get_doctor_day_schedule() — arrived patients and still-expected bookings
--     in one list
-- ============================================================================

-- ---------------------------------------------------------------- appointments
alter table public.appointments
  add column if not exists visit_type          text,
  add column if not exists booking_source      text,
  add column if not exists parent_encounter_id uuid,
  add column if not exists booked_at           timestamptz;

update public.appointments set booking_source = 'walk_in' where booking_source is null;
update public.appointments set visit_type = 'new' where visit_type is null;

alter table public.appointments alter column booking_source set default 'walk_in';
alter table public.appointments alter column visit_type set default 'new';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_visit_type_check') then
    alter table public.appointments add constraint appointments_visit_type_check
      check (visit_type in ('new', 'follow_up', 'review', 'procedure'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_booking_source_check') then
    alter table public.appointments add constraint appointments_booking_source_check
      check (booking_source in ('walk_in', 'booked', 'follow_up_auto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_parent_encounter_fkey') then
    alter table public.appointments add constraint appointments_parent_encounter_fkey
      foreign key (parent_encounter_id) references public.opd_encounters(id) on delete set null;
  end if;
end $$;

comment on column public.appointments.visit_type is
  'Clinical kind of visit being booked: new | follow_up | review | procedure.';
comment on column public.appointments.booking_source is
  'How the slot came to exist: walk_in (created at the desk on arrival), booked (arranged in advance), follow_up_auto (created by schedule_follow_up from an encounter).';
comment on column public.appointments.parent_encounter_id is
  'The encounter that asked for this follow-up, when there is one.';

-- NOTE: this is the SECOND foreign key from appointments to opd_encounters
-- (encounter_id was the first). PostgREST cannot resolve a bare embed between two
-- tables that have more than one relationship, so any `appointments ( ... )` or
-- `opd_encounters ( ... )` embed must now name its constraint, e.g.
-- `appointments!appointments_encounter_id_fkey ( vitals )`.

-- One live follow-up per encounter: re-running schedule_follow_up moves the date
-- rather than stacking bookings.
create unique index if not exists appointments_one_live_followup_per_encounter
  on public.appointments (parent_encounter_id)
  where parent_encounter_id is not null and status <> 'cancelled';

create index if not exists appointments_hospital_date_status_idx
  on public.appointments (hospital_id, appointment_date, status);

-- A token belongs to one patient per hospital per day. Client code allocated it
-- with "select max(token_number) + 1", which two reception desks can win at the
-- same time; this is the backstop, check_in_appointment() is the fix.
create unique index if not exists reception_queue_token_per_day_unique
  on public.reception_queue (hospital_id, queue_date, token_number)
  where token_number is not null;

-- ---------------------------------------------------------------- encounter visit type
alter table public.opd_encounters add column if not exists visit_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'opd_encounters_visit_type_check') then
    alter table public.opd_encounters add constraint opd_encounters_visit_type_check
      check (visit_type is null or visit_type in ('new', 'scheduled_follow_up', 'unscheduled_return'));
  end if;
end $$;

comment on column public.opd_encounters.visit_type is
  'new = first visit at this hospital; scheduled_follow_up = the patient was expected (booked or follow-up); unscheduled_return = a repeat patient who walked in.';

create index if not exists opd_encounters_patient_created_idx
  on public.opd_encounters (patient_id, created_at);

create or replace function public._derive_encounter_visit_type(
  p_encounter_id  uuid,
  p_patient_id    uuid,
  p_hospital_id   uuid,
  p_appointment_id uuid,
  p_created       timestamptz
) returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_prior  boolean;
  v_source text;
begin
  if p_patient_id is null then
    return 'new';
  end if;

  select exists (
    select 1 from opd_encounters e
     where e.patient_id = p_patient_id
       and (p_hospital_id is null or e.hospital_id = p_hospital_id)
       and (p_encounter_id is null or e.id <> p_encounter_id)
       and e.created_at < coalesce(p_created, now())
  ) into v_prior;

  -- A first visit is 'new' whether or not it was booked in advance.
  if not v_prior then
    return 'new';
  end if;

  if p_appointment_id is not null then
    select booking_source into v_source from appointments where id = p_appointment_id;
    if coalesce(v_source, 'walk_in') in ('booked', 'follow_up_auto') then
      return 'scheduled_follow_up';
    end if;
  end if;

  return 'unscheduled_return';
end;
$function$;

create or replace function public.trg_set_encounter_visit_type()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.visit_type is null then
    new.visit_type := public._derive_encounter_visit_type(
      new.id, new.patient_id, new.hospital_id, new.appointment_id,
      coalesce(new.created_at, now()));
  end if;
  return new;
end;
$function$;

drop trigger if exists set_encounter_visit_type on public.opd_encounters;
create trigger set_encounter_visit_type
  before insert on public.opd_encounters
  for each row execute function public.trg_set_encounter_visit_type();

update public.opd_encounters e
   set visit_type = public._derive_encounter_visit_type(
         e.id, e.patient_id, e.hospital_id, e.appointment_id, e.created_at)
 where e.visit_type is null;

-- ---------------------------------------------------------------- scope guard
-- _assert_hospital_scope() had no entry for appointments, so the RPCs below
-- would have had no tenant guard at all.
create or replace function public._assert_hospital_scope(p_kind text, p_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_mine uuid; v_target uuid;
begin
  if p_id is null or coalesce(auth.role(), '') <> 'authenticated' then return; end if;
  v_target := case p_kind
    when 'hospital' then p_id
    when 'patient' then (select hospital_id from patients where id = p_id)
    when 'encounter' then (select hospital_id from opd_encounters where id = p_id)
    when 'appointment' then (select hospital_id from appointments where id = p_id)
    when 'queue' then (select hospital_id from reception_queue where id = p_id)
    when 'admission' then (select hospital_id from ipd_admissions where id = p_id)
    when 'practitioner' then (select hospital_id from practitioners where id = p_id or user_id = p_id limit 1)
    when 'bed' then (select hospital_id from ipd_beds where id = p_id)
    when 'ward' then (select hospital_id from ipd_wards where id = p_id)
    when 'invoice' then (select hospital_id from invoices where id = p_id)
    when 'invoice_line' then (select i.hospital_id from invoice_line_items l join invoices i on i.id = l.invoice_id where l.id = p_id)
    when 'account' then (select hospital_id from accounts where id = p_id)
    when 'charge_item' then (select hospital_id from charge_items where id = p_id)
    when 'claim' then (select hospital_id from insurance_claims where id = p_id)
    when 'preauth' then (select hospital_id from insurance_preauths where id = p_id)
    when 'inventory' then (select hospital_id from hospital_inventory where id = p_id)
    when 'note' then (select hospital_id from ipd_progress_notes where id = p_id)
    when 'treatment' then (select hospital_id from ipd_treatments where id = p_id)
    when 'task' then (select hospital_id from nursing_tasks where id = p_id)
    when 'investigation' then (select hospital_id from investigations where id = p_id)
    when 'ipd_order' then (select hospital_id from ipd_investigation_orders where id = p_id)
    when 'prescription' then (select e.hospital_id from prescriptions r join opd_encounters e on e.id = r.encounter_id where r.id = p_id)
    when 'ward_inventory' then (select hospital_id from ward_inventory where id = p_id)
    when 'department' then (select hospital_id from departments where id = p_id)
    when 'consent' then (select hospital_id from ipd_admission_consents where id = p_id)
    when 'xray_template' then (select hospital_id from xray_measurement_templates where id = p_id)
    when 'xray_measurement' then (select hospital_id from xray_measurements where id = p_id)
    else null end;
  if v_target is null then return; end if;  -- missing row: the RPC's own "not found" handling applies
  v_mine := auth_hospital_id();
  if v_mine is null or v_target <> v_mine then
    raise exception 'Not permitted: record belongs to another hospital' using errcode = '42501';
  end if;
end;
$function$;

-- ---------------------------------------------------------------- schedule a follow-up
create or replace function public.schedule_follow_up(
  p_encounter_id uuid,
  p_date         date,
  p_time         time default null,
  p_doctor_id    uuid default null,
  p_notes        text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_enc     opd_encounters;
  v_doc     uuid;
  v_appt_id uuid;
  v_created boolean := false;
begin
  perform public._assert_hospital_scope('encounter', p_encounter_id);

  select * into v_enc from opd_encounters where id = p_encounter_id;
  if not found then
    raise exception 'Encounter not found' using errcode = 'P0002';
  end if;
  if p_date is null then
    raise exception 'A follow-up date is required' using errcode = '22004';
  end if;
  if p_date < current_date then
    raise exception 'Follow-up date is in the past' using errcode = '22007';
  end if;

  v_doc := coalesce(p_doctor_id, v_enc.doctor_id);
  if v_doc is not null then
    select p.id into v_doc from practitioners p
     where p.id = v_doc or p.user_id = v_doc limit 1;
  end if;

  select id into v_appt_id from appointments
   where parent_encounter_id = p_encounter_id and coalesce(status, '') <> 'cancelled'
   limit 1;

  if v_appt_id is null then
    insert into appointments (hospital_id, patient_id, doctor_id, assigned_doctor_id,
                              appointment_date, scheduled_time, start_time, status,
                              visit_type, booking_source, parent_encounter_id, booked_at,
                              chief_complaint)
    values (v_enc.hospital_id, v_enc.patient_id, v_doc, v_doc,
            p_date, p_time, p_time, 'scheduled',
            'follow_up', 'follow_up_auto', p_encounter_id, now(),
            coalesce(nullif(btrim(p_notes), ''), v_enc.chief_complaint))
    returning id into v_appt_id;
    v_created := true;
  else
    update appointments
       set appointment_date = p_date,
           scheduled_time   = p_time,
           start_time       = p_time,
           doctor_id        = coalesce(v_doc, doctor_id),
           assigned_doctor_id = coalesce(v_doc, assigned_doctor_id),
           status           = 'scheduled',
           booked_at        = now(),
           chief_complaint  = coalesce(nullif(btrim(p_notes), ''), chief_complaint)
     where id = v_appt_id;
  end if;

  update opd_encounters set follow_up_date = p_date where id = p_encounter_id;

  return jsonb_build_object(
    'success', true,
    'created', v_created,
    'appointment_id', v_appt_id,
    'appointment_date', p_date,
    'scheduled_time', p_time,
    'doctor_id', v_doc);
end;
$function$;

create or replace function public.cancel_follow_up(p_encounter_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  perform public._assert_hospital_scope('encounter', p_encounter_id);

  update appointments
     set status = 'cancelled'
   where parent_encounter_id = p_encounter_id
     and coalesce(status, '') not in ('cancelled', 'completed');
  get diagnostics v_count = row_count;

  update opd_encounters set follow_up_date = null where id = p_encounter_id;

  return jsonb_build_object('success', true, 'cancelled', v_count);
end;
$function$;

create or replace function public.get_follow_up_for_encounter(p_encounter_id uuid)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v json;
begin
  perform public._assert_hospital_scope('encounter', p_encounter_id);

  select row_to_json(a) into v
  from (
    select ap.id as appointment_id, ap.appointment_date, ap.scheduled_time, ap.status,
           ap.visit_type, ap.booking_source, ap.doctor_id,
           pr.full_name as doctor_name,
           ap.encounter_id as fulfilled_by_encounter_id
      from appointments ap
      left join practitioners pr on pr.id = ap.doctor_id
     where ap.parent_encounter_id = p_encounter_id
       and coalesce(ap.status, '') <> 'cancelled'
     order by ap.appointment_date
     limit 1
  ) a;

  return v;
end;
$function$;

-- ---------------------------------------------------------------- reception reconciliation
create or replace function public.find_appointment_for_patient(
  p_patient_id uuid,
  p_date       date default null
) returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v json; v_date date := coalesce(p_date, current_date);
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  select json_agg(row_to_json(a) order by a.appointment_date, a.scheduled_time nulls last) into v
  from (
    select ap.id as appointment_id, ap.appointment_date, ap.scheduled_time,
           ap.status, ap.visit_type, ap.booking_source, ap.chief_complaint,
           ap.doctor_id, pr.full_name as doctor_name,
           ap.parent_encounter_id,
           exists (select 1 from reception_queue q where q.appointment_id = ap.id) as already_checked_in
      from appointments ap
      left join practitioners pr on pr.id = ap.doctor_id
     where ap.patient_id = p_patient_id
       and ap.appointment_date = v_date
       and coalesce(ap.booking_source, 'walk_in') in ('booked', 'follow_up_auto')
       and coalesce(ap.status, '') not in ('cancelled', 'completed', 'no_show')
  ) a;

  return coalesce(v, '[]'::json);
end;
$function$;

create or replace function public.check_in_appointment(
  p_appointment_id uuid,
  p_doctor_id      uuid default null,
  p_room           text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_appt   appointments;
  v_doc    uuid;
  v_queue  reception_queue;
  v_token  int;
  v_date   date;
begin
  perform public._assert_hospital_scope('appointment', p_appointment_id);

  select * into v_appt from appointments where id = p_appointment_id;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;
  if coalesce(v_appt.status, '') in ('cancelled', 'completed') then
    raise exception 'That appointment is % and cannot be checked in', v_appt.status
      using errcode = '22023';
  end if;

  -- Idempotent: an already checked-in appointment returns its existing token.
  select * into v_queue from reception_queue where appointment_id = p_appointment_id limit 1;
  if found then
    return jsonb_build_object(
      'success', true, 'already_checked_in', true,
      'queue_id', v_queue.id, 'token_number', v_queue.token_number,
      'token_display', coalesce(v_queue.token_prefix, 'OPD') || '-' ||
                       lpad(coalesce(v_queue.token_number, 0)::text, 3, '0'));
  end if;

  v_date := coalesce(v_appt.appointment_date, current_date);
  v_doc  := coalesce(p_doctor_id, v_appt.assigned_doctor_id, v_appt.doctor_id);
  if v_doc is not null then
    select p.id into v_doc from practitioners p where p.id = v_doc or p.user_id = v_doc limit 1;
  end if;

  -- Serialise token allocation per hospital-day so two desks cannot hand out the
  -- same number.
  perform pg_advisory_xact_lock(hashtextextended(v_appt.hospital_id::text || ':' || v_date::text, 0));

  select coalesce(max(token_number), 0) + 1 into v_token
    from reception_queue
   where hospital_id = v_appt.hospital_id and queue_date = v_date;

  insert into reception_queue (hospital_id, patient_id, appointment_id, token_number, token_prefix,
                               queue_date, queue_status, assigned_doctor_id, doctor_id,
                               assigned_room, registered_at, created_at, updated_at)
  values (v_appt.hospital_id, v_appt.patient_id, p_appointment_id, v_token, 'OPD',
          v_date, 'registered', v_doc, v_doc,
          coalesce(nullif(btrim(p_room), ''), v_appt.room), now(), now(), now())
  returning * into v_queue;

  update appointments
     set status = 'registered',
         check_in_time = now(),
         token = 'OPD-' || lpad(v_token::text, 3, '0')
   where id = p_appointment_id;

  return jsonb_build_object(
    'success', true, 'already_checked_in', false,
    'queue_id', v_queue.id, 'token_number', v_token,
    'token_display', 'OPD-' || lpad(v_token::text, 3, '0'),
    'visit_type', v_appt.visit_type,
    'booking_source', v_appt.booking_source);
end;
$function$;

-- ---------------------------------------------------------------- the doctor's day
create or replace function public.get_doctor_day_schedule(
  p_doctor_id uuid default null,
  p_date      date default null
) returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_doc      uuid;
  v_hospital uuid := auth_hospital_id();
  v_date     date := coalesce(p_date, current_date);
  v          json;
begin
  if p_doctor_id is not null then
    perform public._assert_hospital_scope('practitioner', p_doctor_id);
    select p.id into v_doc from practitioners p where p.id = p_doctor_id or p.user_id = p_doctor_id limit 1;
  end if;

  if v_hospital is null then
    select hospital_id into v_hospital from practitioners where id = v_doc;
  end if;

  select json_agg(row_to_json(s) order by s.arrived desc, s.token_number nulls last, s.scheduled_time nulls last)
    into v
  from (
    -- patients who are here
    select 'queue'::text            as source,
           q.id                     as queue_id,
           q.appointment_id,
           q.encounter_id,
           q.patient_id,
           pt.full_name             as patient_name,
           q.token_number,
           coalesce(q.token_prefix, 'OPD') || '-' || lpad(coalesce(q.token_number, 0)::text, 3, '0') as token_display,
           ap.scheduled_time,
           coalesce(e.visit_type,
                    case when coalesce(ap.booking_source, 'walk_in') in ('booked', 'follow_up_auto')
                         then 'scheduled_follow_up' end) as visit_type,
           q.queue_status           as status,
           true                     as arrived
      from reception_queue q
      join patients pt on pt.id = q.patient_id
      left join appointments ap on ap.id = q.appointment_id
      left join opd_encounters e on e.id = q.encounter_id
     where q.queue_date = v_date
       and (v_hospital is null or q.hospital_id = v_hospital)
       and (v_doc is null or coalesce(q.assigned_doctor_id, q.doctor_id) = v_doc)

    union all

    -- booked patients who have not arrived yet
    select 'appointment'::text,
           null::uuid,
           ap.id,
           ap.encounter_id,
           ap.patient_id,
           pt.full_name,
           null::int,
           null::text,
           ap.scheduled_time,
           case when ap.parent_encounter_id is not null or ap.visit_type = 'follow_up'
                then 'scheduled_follow_up' else 'new' end,
           coalesce(ap.status, 'scheduled'),
           false
      from appointments ap
      join patients pt on pt.id = ap.patient_id
     where ap.appointment_date = v_date
       and coalesce(ap.booking_source, 'walk_in') in ('booked', 'follow_up_auto')
       and coalesce(ap.status, '') not in ('cancelled', 'completed', 'no_show')
       and (v_hospital is null or ap.hospital_id = v_hospital)
       and (v_doc is null or coalesce(ap.assigned_doctor_id, ap.doctor_id) = v_doc)
       and not exists (select 1 from reception_queue q where q.appointment_id = ap.id)
  ) s;

  return coalesce(v, '[]'::json);
end;
$function$;

-- ---------------------------------------------------------------- grants
revoke all on function public.schedule_follow_up(uuid, date, time, uuid, text) from public, anon;
revoke all on function public.cancel_follow_up(uuid) from public, anon;
revoke all on function public.get_follow_up_for_encounter(uuid) from public, anon;
revoke all on function public.find_appointment_for_patient(uuid, date) from public, anon;
revoke all on function public.check_in_appointment(uuid, uuid, text) from public, anon;
revoke all on function public.get_doctor_day_schedule(uuid, date) from public, anon;
revoke all on function public._derive_encounter_visit_type(uuid, uuid, uuid, uuid, timestamptz) from public, anon;

grant execute on function public.schedule_follow_up(uuid, date, time, uuid, text) to authenticated, service_role;
grant execute on function public.cancel_follow_up(uuid) to authenticated, service_role;
grant execute on function public.get_follow_up_for_encounter(uuid) to authenticated, service_role;
grant execute on function public.find_appointment_for_patient(uuid, date) to authenticated, service_role;
grant execute on function public.check_in_appointment(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.get_doctor_day_schedule(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------- visit type into the FHIR document
-- The OP Consult bundle builder (20260917184152) predates opd_encounters.visit_type,
-- so it cannot reference the column in its own file. Rather than restating the whole
-- 250-line builder here, splice Encounter.type into the existing definition. The
-- block is idempotent and raises if the anchor it expects has moved, so a drift
-- between the two migrations fails loudly instead of silently doing nothing.
--
-- SNOMED CT: 185389009 follow-up visit, 270430005 provider-initiated encounter,
-- 270427003 patient-initiated encounter, 185347001 encounter for problem.
do $do$
declare
  src text;
  anchor text := E'          ''class'', jsonb_build_object(''system'', ''http://terminology.hl7.org/CodeSystem/v3-ActCode'',\n                                      ''code'', ''AMB'', ''display'', ''ambulatory''),\n';
  addition text := E'          ''type'', case p_encounter.visit_type\n                    when ''scheduled_follow_up'' then jsonb_build_array(jsonb_build_object(\n                      ''text'', ''Scheduled follow-up visit'',\n                      ''coding'', jsonb_build_array(\n                        jsonb_build_object(''system'', ''http://snomed.info/sct'', ''code'', ''185389009'', ''display'', ''Follow-up visit''),\n                        jsonb_build_object(''system'', ''http://snomed.info/sct'', ''code'', ''270430005'', ''display'', ''Provider-initiated encounter''))))\n                    when ''unscheduled_return'' then jsonb_build_array(jsonb_build_object(\n                      ''text'', ''Unscheduled return visit'',\n                      ''coding'', jsonb_build_array(\n                        jsonb_build_object(''system'', ''http://snomed.info/sct'', ''code'', ''185389009'', ''display'', ''Follow-up visit''),\n                        jsonb_build_object(''system'', ''http://snomed.info/sct'', ''code'', ''270427003'', ''display'', ''Patient-initiated encounter''))))\n                    else jsonb_build_array(jsonb_build_object(\n                      ''text'', ''New patient visit'',\n                      ''coding'', jsonb_build_array(\n                        jsonb_build_object(''system'', ''http://snomed.info/sct'', ''code'', ''185347001'', ''display'', ''Encounter for problem''))))\n                  end,\n';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_opd_consult_bundle';

  if src is null then
    raise exception 'build_opd_consult_bundle() is missing; run 20260917184152 first';
  end if;
  if position('185389009' in src) > 0 then
    raise notice 'Encounter.type already present';
    return;
  end if;
  if position(anchor in src) = 0 then
    raise exception 'anchor not found in build_opd_consult_bundle source';
  end if;

  execute replace(src, anchor, anchor || addition);
end
$do$;

update public.opd_encounters set updated_at = updated_at;
