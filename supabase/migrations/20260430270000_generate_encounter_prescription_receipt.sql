-- Combined pharmacy receipt for all ordered Rx lines in one OPD encounter (one print / one confirm).
create or replace function public.generate_encounter_prescription_receipt(p_encounter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_patient text;
  v_docpad text;
  v_age int;
  v_sex text;
  v_pharm text;
  v_hosp text;
  v_dispensed_at timestamptz;
  v_meds jsonb := '[]'::jsonb;
  r record;
begin
  v_org := public.auth_org();
  if v_org is null then
    raise exception 'no hospital context';
  end if;

  if not exists (
    select 1
    from public.opd_encounters e
    where e.id = p_encounter_id
      and e.hospital_id = v_org
  ) then
    raise exception 'encounter not found or access denied';
  end if;

  for r in
    select
      p.id as prescription_id,
      p.medicine_name,
      p.total_quantity,
      p.dispensed_quantity,
      p.dosage_text,
      p.frequency,
      p.duration,
      p.instructions,
      pt.full_name,
      pt.docpad_id,
      pt.age_years,
      pt.sex
    from public.prescriptions p
    inner join public.opd_encounters e on e.id = p.encounter_id
    inner join public.patients pt on pt.id = e.patient_id
    where p.encounter_id = p_encounter_id
      and e.hospital_id = v_org
      and p.status = 'ordered'
    order by p.created_at asc, p.id asc
  loop
    if v_patient is null then
      v_patient := r.full_name;
      v_docpad := r.docpad_id;
      v_age := r.age_years;
      v_sex := r.sex;
    end if;

    v_meds := v_meds || jsonb_build_array(
      jsonb_build_object(
        'prescription_id', r.prescription_id,
        'name', r.medicine_name,
        'dosage', r.dosage_text,
        'frequency', r.frequency,
        'duration', r.duration,
        'quantity',
          case
            when r.dispensed_quantity is not null and r.total_quantity is not null
              then r.dispensed_quantity::text || ' / ' || r.total_quantity::text
            when r.dispensed_quantity is not null then r.dispensed_quantity::text
            when r.total_quantity is not null then r.total_quantity::text
            else null
          end,
        'dispensed_quantity', r.dispensed_quantity,
        'total_quantity', r.total_quantity,
        'instructions', r.instructions
      )
    );
  end loop;

  if jsonb_array_length(v_meds) < 1 then
    raise exception 'no ordered prescriptions for this encounter';
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

  v_dispensed_at := clock_timestamp();

  return jsonb_build_object(
    'receipt_number', 'RX-VIS-' || upper(substr(replace(p_encounter_id::text, '-', ''), 1, 12)),
    'encounter_id', p_encounter_id,
    'patient', jsonb_build_object(
      'name', v_patient,
      'docpad_id', v_docpad,
      'age_years', v_age,
      'sex', v_sex
    ),
    'medications', v_meds,
    'medication', v_meds->0,
    'pharmacist', jsonb_build_object(
      'name', coalesce(v_pharm, '—'),
      'registration', null
    ),
    'hospital', jsonb_build_object(
      'name', coalesce(v_hosp, '—')
    ),
    'dispensed_at', to_jsonb(v_dispensed_at)
  );
end;
$$;

grant execute on function public.generate_encounter_prescription_receipt(uuid) to authenticated;

comment on function public.generate_encounter_prescription_receipt(uuid) is
  'Receipt JSON for all ordered prescriptions in one encounter; medications[] includes prescription_id per line.';
