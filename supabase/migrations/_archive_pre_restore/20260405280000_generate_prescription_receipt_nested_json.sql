-- Receipt RPC returns nested JSON: patient, medication, pharmacist, hospital, dispensed_at.
create or replace function public.generate_prescription_receipt(prescription_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_med text;
  v_total int;
  v_disp int;
  v_dosage text;
  v_freq text;
  v_dur text;
  v_instr text;
  v_patient text;
  v_docpad text;
  v_pharm text;
  v_hosp text;
  v_dispensed_at timestamptz;
begin
  v_org := public.auth_org();
  if v_org is null then
    raise exception 'no hospital context';
  end if;

  select
    p.medicine_name,
    p.total_quantity,
    p.dispensed_quantity,
    p.dosage_text,
    p.frequency,
    p.duration,
    p.instructions,
    pt.full_name,
    pt.docpad_id,
    p.dispensed_at
  into
    v_med,
    v_total,
    v_disp,
    v_dosage,
    v_freq,
    v_dur,
    v_instr,
    v_patient,
    v_docpad,
    v_dispensed_at
  from public.prescriptions p
  inner join public.opd_encounters e on e.id = p.encounter_id
  inner join public.patients pt on pt.id = e.patient_id
  where p.id = prescription_id
    and e.hospital_id = v_org;

  if not found then
    raise exception 'prescription not found or access denied';
  end if;

  select coalesce(
    nullif(trim(pr.full_name), ''),
    nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
    '—'
  )
  into v_pharm
  from public.practitioners pr
  where (pr.id = auth.uid() or pr.user_id = auth.uid())
    and pr.hospital_id = v_org
  limit 1;

  select coalesce(nullif(trim(o.name), ''), '—')
  into v_hosp
  from public.organizations o
  where o.id = v_org
  limit 1;

  return jsonb_build_object(
    'patient', jsonb_build_object(
      'name', v_patient,
      'docpad_id', v_docpad
    ),
    'medication', jsonb_build_object(
      'name', v_med,
      'total_quantity', v_total,
      'dispensed_quantity', v_disp,
      'dosage_text', v_dosage,
      'frequency', v_freq,
      'duration', v_dur,
      'instructions', v_instr
    ),
    'pharmacist', jsonb_build_object(
      'name', coalesce(v_pharm, '—')
    ),
    'hospital', jsonb_build_object(
      'name', coalesce(v_hosp, '—')
    ),
    'dispensed_at', to_jsonb(coalesce(v_dispensed_at, clock_timestamp()))
  );
end;
$$;

comment on function public.generate_prescription_receipt(uuid) is
  'Nested JSON: patient.name, medication.*, pharmacist.name, hospital.name, dispensed_at.';
