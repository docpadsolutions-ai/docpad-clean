-- SOW 2.5 — appointment and follow-up reminders.
-- One row per (appointment, reminder kind) so a patient is never messaged twice
-- for the same booking, and every send attempt leaves a record.

create table if not exists public.appointment_reminders (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid not null references public.hospitals(id) on delete cascade,
  appointment_id      uuid not null references public.appointments(id) on delete cascade,
  patient_id          uuid references public.patients(id) on delete set null,
  channel             text not null default 'whatsapp' check (channel in ('whatsapp', 'sms')),
  kind                text not null check (kind in ('day_before', 'same_day')),
  appointment_date    date not null,
  status              text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  sent_at             timestamptz,
  error               text,
  provider_message_id text,
  recipient           text,
  created_at          timestamptz not null default now()
);

create unique index if not exists appointment_reminders_once
  on public.appointment_reminders (appointment_id, kind);

create index if not exists appointment_reminders_hospital_date_idx
  on public.appointment_reminders (hospital_id, appointment_date);

alter table public.appointment_reminders enable row level security;

drop policy if exists appointment_reminders_select on public.appointment_reminders;
create policy appointment_reminders_select on public.appointment_reminders
  for select to authenticated
  using (hospital_id = (select auth_hospital_id()));

revoke all on table public.appointment_reminders from public, anon;
grant select on table public.appointment_reminders to authenticated;
grant all on table public.appointment_reminders to service_role;

comment on table public.appointment_reminders is
  'One record per reminder attempt for a booking. The unique index on (appointment_id, kind) is what stops a patient being messaged twice.';

-- ---------------------------------------------------------------- what is due
-- Called by the reminder job with the service key; it is not exposed to staff
-- sessions because it returns phone numbers across the whole hospital.
create or replace function public.due_appointment_reminders(
  p_kind        text default 'day_before',
  p_hospital_id uuid default null
) returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_target date := case when p_kind = 'same_day' then current_date else current_date + 1 end;
  v json;
begin
  if p_kind not in ('day_before', 'same_day') then
    raise exception 'Unknown reminder kind %', p_kind using errcode = '22023';
  end if;

  select json_agg(row_to_json(a) order by a.scheduled_time nulls last) into v
  from (
    select ap.id            as appointment_id,
           ap.hospital_id,
           ap.patient_id,
           ap.appointment_date,
           ap.scheduled_time,
           ap.visit_type,
           ap.booking_source,
           pt.full_name     as patient_name,
           pt.phone         as patient_phone,
           pr.full_name     as doctor_name,
           h.name           as hospital_name
      from appointments ap
      join patients pt on pt.id = ap.patient_id
      left join practitioners pr on pr.id = coalesce(ap.assigned_doctor_id, ap.doctor_id)
      left join hospitals h on h.id = ap.hospital_id
     where ap.appointment_date = v_target
       and coalesce(ap.booking_source, 'walk_in') in ('booked', 'follow_up_auto')
       and coalesce(ap.status, '') not in ('cancelled', 'completed', 'no_show')
       and (p_hospital_id is null or ap.hospital_id = p_hospital_id)
       and coalesce(btrim(pt.phone), '') <> ''
       and not exists (
         select 1 from appointment_reminders r
          where r.appointment_id = ap.id and r.kind = p_kind)
  ) a;

  return coalesce(v, '[]'::json);
end;
$function$;

-- ---------------------------------------------------------------- record the attempt
create or replace function public.record_appointment_reminder(
  p_appointment_id      uuid,
  p_kind                text,
  p_status              text,
  p_recipient           text default null,
  p_provider_message_id text default null,
  p_error               text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_appt appointments;
  v_id   uuid;
begin
  select * into v_appt from appointments where id = p_appointment_id;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  insert into appointment_reminders (hospital_id, appointment_id, patient_id, kind,
                                     appointment_date, status, sent_at, error,
                                     provider_message_id, recipient)
  values (v_appt.hospital_id, p_appointment_id, v_appt.patient_id, p_kind,
          v_appt.appointment_date, p_status,
          case when p_status = 'sent' then now() end,
          p_error, p_provider_message_id, p_recipient)
  on conflict (appointment_id, kind) do update
    set status              = excluded.status,
        sent_at             = coalesce(excluded.sent_at, appointment_reminders.sent_at),
        error               = excluded.error,
        provider_message_id = coalesce(excluded.provider_message_id, appointment_reminders.provider_message_id),
        recipient           = coalesce(excluded.recipient, appointment_reminders.recipient)
  returning id into v_id;

  return jsonb_build_object('success', true, 'reminder_id', v_id);
end;
$function$;

revoke all on function public.due_appointment_reminders(text, uuid) from public, anon, authenticated;
revoke all on function public.record_appointment_reminder(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.due_appointment_reminders(text, uuid) to service_role;
grant execute on function public.record_appointment_reminder(uuid, text, text, text, text, text) to service_role;
