-- SOW 2.3 — DPDP Act 2023: consent record, grievance officer, data principal rights.
--
-- Consent was a checkbox on the registration form that gated the submit button and
-- was then thrown away: nothing recorded what the patient agreed to, when, or to
-- whom, and there was no grievance officer, no grievance register and no way to
-- ask for a correction. This migration puts those on the record.
--
-- Note on history: patients registered before this migration have no consent row.
-- Nothing was stored at the time, so back-filling one would be inventing evidence.
-- Record consent for those patients on their next visit instead.

-- ---------------------------------------------------------------- grievance officer
alter table public.hospitals
  add column if not exists grievance_officer_name  text,
  add column if not exists grievance_officer_email text,
  add column if not exists grievance_officer_phone text,
  add column if not exists privacy_notice_url      text,
  add column if not exists privacy_notice_version  text default 'v1',
  add column if not exists data_retention_years    int  default 7;

comment on column public.hospitals.grievance_officer_name is
  'DPDP Act s.13 grievance officer. Shown at registration and printed on the consent record.';

-- ---------------------------------------------------------------- consent register
create table if not exists public.patient_consents (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references public.hospitals(id) on delete cascade,
  patient_id        uuid not null references public.patients(id) on delete cascade,
  purpose           text not null check (purpose in (
                      'treatment', 'billing_insurance', 'health_records_sharing',
                      'reminders_communication', 'research_anonymised')),
  purpose_text      text,
  status            text not null default 'given' check (status in ('given', 'withdrawn')),
  method            text not null default 'verbal' check (method in ('verbal', 'written', 'digital', 'otp')),
  given_at          timestamptz not null default now(),
  given_by_name     text,
  given_by_relation text,
  notice_version    text,
  recorded_by       uuid references public.practitioners(id) on delete set null,
  withdrawn_at      timestamptz,
  withdrawn_reason  text,
  created_at        timestamptz not null default now()
);

create index if not exists patient_consents_patient_idx on public.patient_consents (patient_id, purpose);
create index if not exists patient_consents_hospital_idx on public.patient_consents (hospital_id, given_at desc);

comment on table public.patient_consents is
  'One row per purpose the patient consented to, kept even after withdrawal - the record of what was agreed is itself the compliance artefact.';

-- ---------------------------------------------------------------- data principal requests
create table if not exists public.data_principal_requests (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid not null references public.hospitals(id) on delete cascade,
  patient_id          uuid references public.patients(id) on delete set null,
  request_type        text not null check (request_type in ('access', 'correction', 'erasure', 'grievance')),
  status              text not null default 'open' check (status in ('open', 'under_review', 'actioned', 'rejected', 'closed')),
  subject             text not null,
  details             text,
  requested_by_name   text,
  requested_by_relation text,
  contact_phone       text,
  contact_email       text,
  raised_at           timestamptz not null default now(),
  raised_by           uuid references public.practitioners(id) on delete set null,
  sla_due_at          timestamptz not null default (now() + interval '30 days'),
  reviewed_by         uuid references public.practitioners(id) on delete set null,
  reviewed_at         timestamptz,
  resolution          text,
  applied_changes     jsonb,
  closed_at           timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists dpr_hospital_status_idx on public.data_principal_requests (hospital_id, status, raised_at desc);
create index if not exists dpr_patient_idx on public.data_principal_requests (patient_id, raised_at desc);

comment on table public.data_principal_requests is
  'The grievance register and the access / correction / erasure queue in one place. sla_due_at defaults to 30 days from the request.';

-- ---------------------------------------------------------------- RLS
alter table public.patient_consents enable row level security;
alter table public.data_principal_requests enable row level security;

drop policy if exists patient_consents_rw on public.patient_consents;
create policy patient_consents_rw on public.patient_consents
  for all to authenticated
  using (hospital_id = (select auth_hospital_id()))
  with check (hospital_id = (select auth_hospital_id()));

drop policy if exists dpr_rw on public.data_principal_requests;
create policy dpr_rw on public.data_principal_requests
  for all to authenticated
  using (hospital_id = (select auth_hospital_id()))
  with check (hospital_id = (select auth_hospital_id()));

revoke all on table public.patient_consents from public, anon;
revoke all on table public.data_principal_requests from public, anon;
grant select, insert, update on table public.patient_consents to authenticated;
grant select, insert, update on table public.data_principal_requests to authenticated;
grant all on table public.patient_consents to service_role;
grant all on table public.data_principal_requests to service_role;

-- These tables are created after the audit rollout, so they need the trigger attached.
drop trigger if exists zz_audit_row on public.patient_consents;
create trigger zz_audit_row after insert or update or delete on public.patient_consents
  for each row execute function public.trg_audit_row();

drop trigger if exists zz_audit_row on public.data_principal_requests;
create trigger zz_audit_row after insert or update or delete on public.data_principal_requests
  for each row execute function public.trg_audit_row();

-- ---------------------------------------------------------------- recording consent
create or replace function public.record_patient_consent(
  p_patient_id     uuid,
  p_purposes       text[],
  p_method         text default 'verbal',
  p_given_by_name  text default null,
  p_given_by_relation text default null
) returns json
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_hospital uuid;
  v_me       uuid;
  v_notice   text;
  v_purpose  text;
  v_ids      uuid[] := '{}';
  v_id       uuid;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  select hospital_id into v_hospital from patients where id = p_patient_id;
  if v_hospital is null then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  if p_purposes is null or array_length(p_purposes, 1) is null then
    raise exception 'At least one purpose is required' using errcode = '22004';
  end if;

  select id into v_me from practitioners where user_id = auth.uid() limit 1;
  select privacy_notice_version into v_notice from hospitals where id = v_hospital;

  foreach v_purpose in array p_purposes loop
    insert into patient_consents (hospital_id, patient_id, purpose, method,
                                  given_by_name, given_by_relation, notice_version, recorded_by)
    values (v_hospital, p_patient_id, v_purpose, coalesce(p_method, 'verbal'),
            p_given_by_name, p_given_by_relation, v_notice, v_me)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  return json_build_object('success', true, 'consent_ids', v_ids);
end;
$function$;

create or replace function public.withdraw_patient_consent(
  p_consent_id uuid,
  p_reason     text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare v_patient uuid;
begin
  select patient_id into v_patient from patient_consents where id = p_consent_id;
  if v_patient is null then
    raise exception 'Consent record not found' using errcode = 'P0002';
  end if;
  perform public._assert_hospital_scope('patient', v_patient);

  update patient_consents
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason
   where id = p_consent_id and status <> 'withdrawn';

  return jsonb_build_object('success', true);
end;
$function$;

-- ---------------------------------------------------------------- the register, per patient
create or replace function public.get_patient_consent_register(p_patient_id uuid)
returns json
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare v json;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);
  perform public.log_phi_read('patient', p_patient_id);

  select json_build_object(
    'generated_at', now(),
    'patient', (select json_build_object('id', pt.id, 'docpad_id', pt.docpad_id,
                                         'full_name', pt.full_name, 'phone', pt.phone,
                                         'registered_at', pt.created_at)
                  from patients pt where pt.id = p_patient_id),
    'hospital', (select json_build_object('name', h.name, 'address',
                          concat_ws(', ', h.address_line1, h.city, h.state, h.pincode),
                          'grievance_officer', json_build_object(
                            'name', h.grievance_officer_name,
                            'email', h.grievance_officer_email,
                            'phone', h.grievance_officer_phone),
                          'privacy_notice_url', h.privacy_notice_url,
                          'privacy_notice_version', h.privacy_notice_version,
                          'data_retention_years', h.data_retention_years)
                   from hospitals h
                   where h.id = (select hospital_id from patients where id = p_patient_id)),
    'consents', coalesce((
      select json_agg(json_build_object(
               'id', c.id, 'purpose', c.purpose, 'status', c.status, 'method', c.method,
               'given_at', c.given_at, 'given_by_name', c.given_by_name,
               'given_by_relation', c.given_by_relation, 'notice_version', c.notice_version,
               'recorded_by', pr.full_name,
               'withdrawn_at', c.withdrawn_at, 'withdrawn_reason', c.withdrawn_reason)
             order by c.given_at desc)
        from patient_consents c
        left join practitioners pr on pr.id = c.recorded_by
       where c.patient_id = p_patient_id), '[]'::json),
    'requests', coalesce((
      select json_agg(json_build_object(
               'id', r.id, 'request_type', r.request_type, 'status', r.status,
               'subject', r.subject, 'details', r.details, 'raised_at', r.raised_at,
               'sla_due_at', r.sla_due_at, 'reviewed_at', r.reviewed_at,
               'resolution', r.resolution, 'applied_changes', r.applied_changes)
             order by r.raised_at desc)
        from data_principal_requests r
       where r.patient_id = p_patient_id), '[]'::json)
  ) into v;

  return v;
end;
$function$;

-- ---------------------------------------------------------------- requests and grievances
create or replace function public.raise_data_principal_request(
  p_patient_id        uuid,
  p_request_type      text,
  p_subject           text,
  p_details           text default null,
  p_requested_by_name text default null,
  p_requested_by_relation text default null,
  p_contact_phone     text default null,
  p_contact_email     text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_hospital uuid;
  v_me       uuid;
  v_id       uuid;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  select hospital_id into v_hospital from patients where id = p_patient_id;
  if v_hospital is null then
    v_hospital := auth_hospital_id();
  end if;
  if v_hospital is null then
    raise exception 'Cannot determine the hospital for this request' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_subject), '') = '' then
    raise exception 'A subject is required' using errcode = '22004';
  end if;

  select id into v_me from practitioners where user_id = auth.uid() limit 1;

  insert into data_principal_requests (hospital_id, patient_id, request_type, subject, details,
                                       requested_by_name, requested_by_relation,
                                       contact_phone, contact_email, raised_by)
  values (v_hospital, p_patient_id, p_request_type, btrim(p_subject), p_details,
          p_requested_by_name, p_requested_by_relation, p_contact_phone, p_contact_email, v_me)
  returning id into v_id;

  return jsonb_build_object('success', true, 'request_id', v_id,
                            'sla_due_at', (select sla_due_at from data_principal_requests where id = v_id));
end;
$function$;

create or replace function public.review_data_principal_request(
  p_request_id uuid,
  p_status     text,
  p_resolution text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_req data_principal_requests;
  v_me  uuid;
begin
  select * into v_req from data_principal_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  perform public._assert_hospital_scope('hospital', v_req.hospital_id);

  if p_status not in ('under_review', 'actioned', 'rejected', 'closed') then
    raise exception 'Unknown status %', p_status using errcode = '22023';
  end if;

  select id into v_me from practitioners where user_id = auth.uid() limit 1;

  update data_principal_requests
     set status      = p_status,
         resolution  = coalesce(nullif(btrim(p_resolution), ''), resolution),
         reviewed_by = v_me,
         reviewed_at = now(),
         closed_at   = case when p_status in ('actioned', 'rejected', 'closed') then now() end
   where id = p_request_id;

  return jsonb_build_object('success', true);
end;
$function$;

-- ---------------------------------------------------------------- applying a correction
-- Writes through the ordinary patients UPDATE so the existing audit trigger records
-- the before and after, and stamps the request with what was changed.
create or replace function public.apply_patient_correction(
  p_request_id uuid,
  p_field      text,
  p_new_value  text
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_req data_principal_requests;
  v_old text;
  v_me  uuid;
  v_allowed constant text[] := array[
    'full_name', 'phone', 'date_of_birth', 'age_years', 'sex', 'blood_group',
    'address_line1', 'address_line2', 'city', 'state', 'pincode', 'abha_address'];
begin
  select * into v_req from data_principal_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_req.patient_id is null then
    raise exception 'That request is not attached to a patient' using errcode = '22023';
  end if;
  perform public._assert_hospital_scope('patient', v_req.patient_id);

  if not (p_field = any(v_allowed)) then
    raise exception 'Field % cannot be corrected through this workflow', p_field using errcode = '22023';
  end if;

  execute format('select (%I)::text from patients where id = $1', p_field)
    into v_old using v_req.patient_id;

  execute format('update patients set %I = $1 where id = $2', p_field)
    using nullif(btrim(p_new_value), ''), v_req.patient_id;

  select id into v_me from practitioners where user_id = auth.uid() limit 1;

  update data_principal_requests
     set status      = 'actioned',
         reviewed_by = coalesce(reviewed_by, v_me),
         reviewed_at = coalesce(reviewed_at, now()),
         closed_at   = now(),
         applied_changes = coalesce(applied_changes, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object('field', p_field, 'from', v_old, 'to', nullif(btrim(p_new_value), ''),
                              'at', now(), 'by', v_me))
   where id = p_request_id;

  return jsonb_build_object('success', true, 'field', p_field, 'from', v_old, 'to', nullif(btrim(p_new_value), ''));
end;
$function$;

create or replace function public.get_grievance_officer(p_hospital_id uuid default null)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v json; v_id uuid := coalesce(p_hospital_id, auth_hospital_id());
begin
  if v_id is null then return null; end if;
  perform public._assert_hospital_scope('hospital', v_id);

  select json_build_object('hospital_name', h.name,
                           'name', h.grievance_officer_name,
                           'email', h.grievance_officer_email,
                           'phone', h.grievance_officer_phone,
                           'privacy_notice_url', h.privacy_notice_url,
                           'privacy_notice_version', h.privacy_notice_version,
                           'data_retention_years', h.data_retention_years)
    into v from hospitals h where h.id = v_id;
  return v;
end;
$function$;

-- ---------------------------------------------------------------- grants
revoke all on function public.record_patient_consent(uuid, text[], text, text, text) from public, anon;
revoke all on function public.withdraw_patient_consent(uuid, text) from public, anon;
revoke all on function public.get_patient_consent_register(uuid) from public, anon;
revoke all on function public.raise_data_principal_request(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.review_data_principal_request(uuid, text, text) from public, anon;
revoke all on function public.apply_patient_correction(uuid, text, text) from public, anon;
revoke all on function public.get_grievance_officer(uuid) from public, anon;

grant execute on function public.record_patient_consent(uuid, text[], text, text, text) to authenticated, service_role;
grant execute on function public.withdraw_patient_consent(uuid, text) to authenticated, service_role;
grant execute on function public.get_patient_consent_register(uuid) to authenticated, service_role;
grant execute on function public.raise_data_principal_request(uuid, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.review_data_principal_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.apply_patient_correction(uuid, text, text) to authenticated, service_role;
grant execute on function public.get_grievance_officer(uuid) to authenticated, service_role;
