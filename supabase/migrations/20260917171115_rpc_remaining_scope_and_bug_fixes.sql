-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917171115.

-- check_patient_exists returned name + DocPad ID of a matching patient from ANY hospital.
create or replace function public.check_patient_exists(p_aadhaar_hash text)
returns table(existing_docpad_id text, existing_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  select p.docpad_id, p.full_name
  from patients p
  join identity_vault.aadhaar_mapping v on p.aadhaar_reference_key = v.reference_key
  where v.aadhaar_hash = p_aadhaar_hash
    and p.hospital_id = auth_hospital_id();
end;
$function$;

-- ensure_daily_progress_notes(): fixed "missing FROM-clause entry for table a" (used a.admitted_at
-- inside the loop). It creates notes for every hospital, so it is for cron / service_role only.
create or replace function public.ensure_daily_progress_notes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admission record;
  v_day_number integer;
  v_count integer := 0;
begin
  for v_admission in
    select a.id, a.hospital_id, a.patient_id, a.admitting_doctor_id, a.admitted_at
    from public.ipd_admissions a
    where a.status = 'in-progress'
      and not exists (
        select 1 from public.ipd_progress_notes n
        where n.admission_id = a.id and n.note_date = current_date)
  loop
    v_day_number := (current_date - v_admission.admitted_at::date) + 1;
    insert into public.ipd_progress_notes (
      hospital_id, admission_id, patient_id, note_date, hospital_day_number,
      day_label, day_tags, authored_by, status)
    values (
      v_admission.hospital_id, v_admission.id, v_admission.patient_id, current_date, v_day_number,
      'Day ' || v_day_number, array[]::text[], v_admission.admitting_doctor_id, 'draft')
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke execute on function public.ensure_daily_progress_notes() from authenticated;

-- The IPD page calls ensure_daily_progress_notes(p_admission_id), which did not exist.
create or replace function public.ensure_daily_progress_notes(p_admission_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admission record;
  v_day_number integer;
  v_rows integer;
begin
  perform public._assert_hospital_scope('admission', p_admission_id);

  select a.id, a.hospital_id, a.patient_id, a.admitting_doctor_id, a.admitted_at
  into v_admission
  from public.ipd_admissions a
  where a.id = p_admission_id and a.status = 'in-progress';

  if not found or exists (
    select 1 from public.ipd_progress_notes n
    where n.admission_id = p_admission_id and n.note_date = current_date) then
    return 0;
  end if;

  v_day_number := (current_date - v_admission.admitted_at::date) + 1;
  insert into public.ipd_progress_notes (
    hospital_id, admission_id, patient_id, note_date, hospital_day_number,
    day_label, day_tags, authored_by, status)
  values (
    v_admission.hospital_id, v_admission.id, v_admission.patient_id, current_date, v_day_number,
    'Day ' || v_day_number, array[]::text[], v_admission.admitting_doctor_id, 'draft')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
revoke all on function public.ensure_daily_progress_notes(uuid) from public, anon;
grant execute on function public.ensure_daily_progress_notes(uuid) to authenticated, service_role;

-- Cron / internal only (not called by the app).
revoke execute on function public.backfill_missing_progress_notes() from authenticated;
revoke execute on function public.notify_overdue_mar_slots() from authenticated;
revoke execute on function public.provision_practitioner_for_invite_token(uuid, text, text, text, text, text, text, text, text) from authenticated;
