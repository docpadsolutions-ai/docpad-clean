-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917174035.

-- "Who opened this chart" logging. The RPCs a person calls to look at a patient now write a READ
-- entry into audit_logs before returning.
create or replace function public.log_phi_read(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hospital uuid;
  v_patient uuid;
begin
  if p_id is null then return; end if;

  case p_kind
    when 'patient' then
      select p.hospital_id, p.id into v_hospital, v_patient from patients p where p.id = p_id;
    when 'encounter' then
      select e.hospital_id, e.patient_id into v_hospital, v_patient from opd_encounters e where e.id = p_id;
    when 'admission' then
      select a.hospital_id, a.patient_id into v_hospital, v_patient from ipd_admissions a where a.id = p_id;
    when 'progress_note' then
      select n.hospital_id, n.patient_id into v_hospital, v_patient from ipd_progress_notes n where n.id = p_id;
    when 'prescription' then
      select e.hospital_id, r.patient_id into v_hospital, v_patient
      from prescriptions r join opd_encounters e on e.id = r.encounter_id where r.id = p_id;
    else
      null;
  end case;

  insert into audit_logs (
    hospital_id, user_id, practitioner_id, action, resource_type, resource_id, new_values)
  values (
    v_hospital,
    v_uid,
    (select p.id from practitioners p where p.user_id = v_uid or p.id = v_uid limit 1),
    case when v_uid is null then 'READ_PUBLIC_LINK' else 'READ' end,
    p_kind,
    p_id,
    jsonb_build_object('patient_id', v_patient));
end;
$$;
revoke all on function public.log_phi_read(text, uuid) from public;
grant execute on function public.log_phi_read(text, uuid) to anon, authenticated, service_role;

do $$
declare
  targets constant jsonb := jsonb_build_object(
    'get_patient_header_data',          jsonb_build_array('patient', 'p_patient_id'),
    'get_health_timeline_nodes',        jsonb_build_array('patient', 'p_patient_id'),
    'get_current_medications',          jsonb_build_array('patient', 'p_patient_id'),
    'get_active_problems',              jsonb_build_array('patient', 'p_patient_id'),
    'get_latest_vitals',                jsonb_build_array('patient', 'p_patient_id'),
    'get_clinical_highlights',          jsonb_build_array('patient', 'p_patient_id'),
    'get_care_team',                    jsonb_build_array('patient', 'p_patient_id'),
    'get_patient_billing_summary',      jsonb_build_array('patient', 'p_patient_id'),
    'get_patient_insurance_eligibility', jsonb_build_array('patient', 'p_patient_id'),
    'get_encounter_details',            jsonb_build_array('encounter', 'p_encounter_id'),
    'get_ipd_admission',                jsonb_build_array('admission', 'p_admission_id'),
    'get_dpn_right_panel',              jsonb_build_array('admission', 'p_admission_id'),
    'get_dpn_timeline',                 jsonb_build_array('admission', 'p_admission_id'),
    'get_admission_timeline',           jsonb_build_array('admission', 'p_admission_id'),
    'get_nurse_mar_for_patient',        jsonb_build_array('admission', 'p_admission_id'),
    'get_latest_handover',              jsonb_build_array('admission', 'p_admission_id'),
    'compile_discharge_summary',        jsonb_build_array('admission', 'p_admission_id'),
    'get_dpn_full_note',                jsonb_build_array('progress_note', 'p_note_id'),
    'generate_prescription_receipt',    jsonb_build_array('prescription', 'prescription_id')
  );
  f record;
  kind text;
  pname text;
  stmt text;
  def text;
  body_start int;
  pos int;
begin
  for f in
    select p.oid, p.proname, l.lanname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and targets ? p.proname
      and p.prosrc not like '%log_phi_read%'
  loop
    kind := targets -> f.proname ->> 0;
    pname := targets -> f.proname ->> 1;
    if not exists (select 1 from unnest(coalesce((select proargnames from pg_proc where oid = f.oid), '{}')) a where a = pname) then
      continue;
    end if;
    if f.lanname = 'plpgsql' then
      stmt := format(E'\n  perform public.log_phi_read(%L, %I);', kind, pname);
    else
      stmt := format(E'\nselect public.log_phi_read(%L, %I);', kind, pname);
    end if;

    def := pg_get_functiondef(f.oid);
    body_start := strpos(def, 'AS $function$') + length('AS $function$');
    if f.lanname = 'plpgsql' then
      pos := body_start - 1 + regexp_instr(substr(def, body_start), '\mbegin\M', 1, 1, 1, 'i');
      def := left(def, pos - 1) || stmt || substr(def, pos);
    else
      def := left(def, body_start - 1) || stmt || substr(def, body_start);
    end if;
    execute def;
  end loop;
end
$$;

-- The public prescription link: log the view too (no signed-in user, so action READ_PUBLIC_LINK).
create or replace function public.get_public_prescription(p_encounter_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  select case when not exists (
      select 1 from opd_encounters e
      where e.id = p_encounter_id
        and exists (select 1 from prescriptions p where p.encounter_id = e.id)) then null
    else jsonb_build_object(
      'encounter', (select jsonb_build_object(
          'id', e.id, 'encounter_number', e.encounter_number, 'encounter_date', e.encounter_date,
          'chief_complaint', e.chief_complaint, 'weight', e.weight, 'blood_pressure', e.blood_pressure,
          'pulse', e.pulse, 'temperature', e.temperature, 'spo2', e.spo2, 'patient_id', e.patient_id)
        from opd_encounters e where e.id = p_encounter_id),
      'patient', (select jsonb_build_object(
          'id', pt.id, 'full_name', pt.full_name, 'age_years', pt.age_years, 'sex', pt.sex,
          'blood_group', pt.blood_group, 'docpad_id', pt.docpad_id)
        from patients pt join opd_encounters e on e.patient_id = pt.id where e.id = p_encounter_id),
      'hospital', (select jsonb_build_object(
          'name', h.name, 'address_line1', h.address_line1, 'city', h.city, 'state', h.state,
          'pincode', h.pincode, 'phone', h.phone, 'email', h.email, 'website', h.website,
          'logo_url', h.logo_url, 'tagline', h.tagline, 'registration_no', h.registration_no,
          'letterhead_color', h.letterhead_color, 'nabh_accredited', coalesce(h.nabh_accredited, false),
          'nabh_certificate_number', h.nabh_certificate_number,
          'prescription_header_config', h.prescription_header_config)
        from hospitals h join opd_encounters e on e.hospital_id = h.id where e.id = p_encounter_id),
      'doctor', (select jsonb_build_object(
          'full_name', d.full_name, 'specialty', d.specialty, 'registration_no', d.registration_no)
        from practitioners d join opd_encounters e on (d.id = e.doctor_id or d.user_id = e.doctor_id)
        where e.id = p_encounter_id limit 1),
      'prescriptions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'medicine_name', p.medicine_name, 'active_ingredient_name', p.active_ingredient_name,
          'dosage_form_name', p.dosage_form_name, 'dosage_text', p.dosage_text,
          'frequency', p.frequency, 'duration', p.duration, 'instructions', p.instructions)
          order by p.created_at, p.id)
        from prescriptions p where p.encounter_id = p_encounter_id), '[]'::jsonb),
      'lab_blocks', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.ocr_upload_id,
          'title', coalesce(nullif(trim(a.display_name), ''), 'Lab report'),
          'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                     'parameter_name', l.parameter_name, 'value_numeric', l.value_numeric,
                     'value_text', l.value_text, 'unit', l.unit, 'ref_range_text', l.ref_range_text)
                     order by l.created_at, l.id), '[]'::jsonb)
                   from lab_result_entries l where l.ocr_upload_id = a.ocr_upload_id)))
        from (select distinct on (pa.ocr_upload_id) pa.ocr_upload_id, pa.display_name
              from prescription_attachments pa
              where pa.encounter_id = p_encounter_id and pa.include_in_print and pa.ocr_upload_id is not null
              order by pa.ocr_upload_id, pa.created_at) a), '[]'::jsonb))
    end into v_payload;

  if v_payload is not null then
    perform public.log_phi_read('encounter', p_encounter_id);
  end if;
  return v_payload;
end;
$$;
revoke all on function public.get_public_prescription(uuid) from public;
grant execute on function public.get_public_prescription(uuid) to anon, authenticated;

-- Retention: keep 24 months.
select cron.schedule('audit-logs-retention', '17 3 1 * *',
  $cron$delete from public.audit_logs where created_at < now() - interval '24 months'$cron$);
