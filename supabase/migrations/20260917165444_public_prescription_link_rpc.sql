-- Public, read-only view of ONE prescription for the WhatsApp link (/rx/<encounter uuid>).
-- The unguessable encounter UUID acts as the share token. Returns only what the printout needs
-- (no patient phone, address, ABHA, or other encounters).
create or replace function public.get_public_prescription(p_encounter_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with enc as (
    select e.id, e.encounter_number, e.encounter_date, e.chief_complaint, e.weight,
           e.blood_pressure, e.pulse, e.temperature, e.spo2, e.patient_id, e.hospital_id, e.doctor_id
    from opd_encounters e
    where e.id = p_encounter_id
      and exists (select 1 from prescriptions p where p.encounter_id = e.id)
  )
  select case when not exists (select 1 from enc) then null else jsonb_build_object(
    'encounter', (select jsonb_build_object(
        'id', id, 'encounter_number', encounter_number, 'encounter_date', encounter_date,
        'chief_complaint', chief_complaint, 'weight', weight, 'blood_pressure', blood_pressure,
        'pulse', pulse, 'temperature', temperature, 'spo2', spo2, 'patient_id', patient_id)
      from enc),
    'patient', (select jsonb_build_object(
        'id', pt.id, 'full_name', pt.full_name, 'age_years', pt.age_years, 'sex', pt.sex,
        'blood_group', pt.blood_group, 'docpad_id', pt.docpad_id)
      from patients pt join enc on enc.patient_id = pt.id),
    'hospital', (select jsonb_build_object(
        'name', h.name, 'address_line1', h.address_line1, 'city', h.city, 'state', h.state,
        'pincode', h.pincode, 'phone', h.phone, 'email', h.email, 'website', h.website,
        'logo_url', h.logo_url, 'tagline', h.tagline, 'registration_no', h.registration_no,
        'letterhead_color', h.letterhead_color, 'nabh_accredited', coalesce(h.nabh_accredited, false),
        'nabh_certificate_number', h.nabh_certificate_number,
        'prescription_header_config', h.prescription_header_config)
      from hospitals h join enc on enc.hospital_id = h.id),
    'doctor', (select jsonb_build_object(
        'full_name', d.full_name, 'specialty', d.specialty, 'registration_no', d.registration_no)
      from practitioners d join enc on (d.id = enc.doctor_id or d.user_id = enc.doctor_id)
      limit 1),
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
            order by pa.ocr_upload_id, pa.created_at) a), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_public_prescription(uuid) from public;
grant execute on function public.get_public_prescription(uuid) to anon, authenticated;

comment on function public.get_public_prescription(uuid) is
  'Public prescription link payload (WhatsApp /rx/<id>). Intentionally anon-callable; returns one encounter only.';
