-- NOTE: kept from the repo rather than restored from the database.
-- This migration was corrected in place after it was first applied, with
-- execute_sql rather than a new migration, so schema_migrations still holds the
-- original. The live database has the corrected version; this file is what
-- reproduces it. See scripts/restore-migration-files.mjs for the restore itself.

-- ============================================================================
-- OP Consult Record — real FHIR R4 document Bundle
--
-- Replaces the previous three-field `fhir_json` stub on opd_encounters with a
-- NRCES/ABDM-shaped OP Consult Record: a Bundle of type `document` whose first
-- entry is a Composition (SNOMED 371530004) carrying the clinical sections, and
-- whose remaining entries are the referenced Patient, Encounter, Practitioner,
-- Organization, Condition, AllergyIntolerance, Observation (vitals),
-- MedicationRequest and ServiceRequest resources.
--
-- Reference integrity: every fullUrl is a `urn:uuid:` URN and every internal
-- reference points at one of those URNs, so the document resolves standalone
-- (relative `Type/id` references do not resolve inside a urn:uuid document).
-- Timestamps are emitted as FHIR `instant` in UTC ("...Z"); the `+00` that
-- to_char(..., 'OF') produces is not a valid FHIR offset.
--
-- Resource urn:uuids are minted per build, which is what urn:uuid fullUrls are
-- for in a document. The stable identity of the document is Bundle.identifier
-- and Composition.identifier (the encounter number) — key deduplication on
-- those, not on the resource UUIDs.
-- ============================================================================

-- ---------------------------------------------------------------- helpers
create or replace function public._fhir_instant(p_ts timestamptz)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when p_ts is null then null
              else to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end;
$$;

comment on function public._fhir_instant(timestamptz) is
  'Formats a timestamptz as a FHIR R4 instant in UTC. Internal helper.';

-- ---------------------------------------------------------------- bundle builder
create or replace function public.build_opd_consult_bundle(p_encounter public.opd_encounters)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_patient      record;
  v_doctor       record;
  v_hospital     record;
  v_final        boolean;
  v_entries      jsonb := '[]'::jsonb;
  v_sections     jsonb := '[]'::jsonb;
  v_meds         jsonb := '[]'::jsonb;
  v_med_refs     jsonb := '[]'::jsonb;
  v_vitals       jsonb := '[]'::jsonb;
  v_vital_refs   jsonb := '[]'::jsonb;
  v_conditions   jsonb := '[]'::jsonb;
  v_cond_refs    jsonb := '[]'::jsonb;
  v_allergies    jsonb := '[]'::jsonb;
  v_allergy_refs jsonb := '[]'::jsonb;
  v_orders       jsonb := '[]'::jsonb;
  v_order_refs   jsonb := '[]'::jsonb;
  r              record;
  v_ref          text;
  -- urn:uuid fullUrls, reused as the target of every internal reference
  v_comp_id      uuid := gen_random_uuid();
  v_comp_ref     text;
  v_pat_ref      text;
  v_enc_ref      text;
  v_doc_ref      text;
  v_org_ref      text;
  v_recorded     text;
begin
  select * into v_patient from patients where id = p_encounter.patient_id;
  select * into v_doctor from practitioners
   where id = p_encounter.doctor_id or user_id = p_encounter.doctor_id limit 1;
  select * into v_hospital from hospitals where id = p_encounter.hospital_id;

  v_final := coalesce(p_encounter.status, '') in ('completed', 'final', 'finalized', 'closed')
             or p_encounter.prescription_finalized_at is not null;

  v_comp_ref := 'urn:uuid:' || v_comp_id::text;
  v_pat_ref  := 'urn:uuid:' || p_encounter.patient_id::text;
  v_enc_ref  := 'urn:uuid:' || p_encounter.id::text;
  v_doc_ref  := case when v_doctor.id is not null then 'urn:uuid:' || v_doctor.id::text end;
  v_org_ref  := case when v_hospital.id is not null then 'urn:uuid:' || v_hospital.id::text end;
  v_recorded := public._fhir_instant(coalesce(p_encounter.updated_at, p_encounter.created_at));

  -- ---------------------------------------------------------------- vitals as Observations
  for r in
    select * from (values
      ('29463-7', 'Body weight',            p_encounter.weight::text,      'kg'),
      ('8867-4',  'Heart rate',             p_encounter.pulse::text,       '/min'),
      ('8310-5',  'Body temperature',       p_encounter.temperature::text, 'Cel'),
      ('59408-5', 'Oxygen saturation',      p_encounter.spo2::text,        '%'),
      ('85354-9', 'Blood pressure panel',   p_encounter.blood_pressure,    null)
    ) as v(loinc, display, value, unit)
    where v.value is not null and btrim(v.value) <> ''
  loop
    v_ref := 'urn:uuid:' || gen_random_uuid()::text;
    v_vitals := v_vitals || jsonb_build_array(jsonb_build_object(
      'fullUrl', v_ref,
      'resource', jsonb_build_object(
        'resourceType', 'Observation',
        'id', right(v_ref, 36),
        'status', 'final',
        'category', jsonb_build_array(jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://terminology.hl7.org/CodeSystem/observation-category',
            'code', 'vital-signs', 'display', 'Vital Signs')))),
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://loinc.org', 'code', r.loinc, 'display', r.display))),
        'subject', jsonb_build_object('reference', v_pat_ref),
        'encounter', jsonb_build_object('reference', v_enc_ref),
        'effectiveDateTime', public._fhir_instant(coalesce(p_encounter.checkin_time, p_encounter.created_at)))
        || case when r.unit is null
                then jsonb_build_object('valueString', r.value)
                else jsonb_build_object('valueQuantity', jsonb_build_object(
                       'value', r.value::numeric, 'unit', r.unit,
                       'system', 'http://unitsofmeasure.org', 'code', r.unit)) end));
    v_vital_refs := v_vital_refs || jsonb_build_array(jsonb_build_object('reference', v_ref));
  end loop;

  -- ---------------------------------------------------------------- diagnosis as Condition
  if coalesce(btrim(p_encounter.working_diagnosis), '') <> ''
     or coalesce(btrim(p_encounter.diagnosis_term), '') <> '' then
    v_ref := 'urn:uuid:' || gen_random_uuid()::text;
    v_conditions := jsonb_build_array(jsonb_build_object(
      'fullUrl', v_ref,
      'resource', jsonb_build_object(
        'resourceType', 'Condition',
        'id', right(v_ref, 36),
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code', 'active'))),
        'code', jsonb_build_object(
          'text', coalesce(nullif(btrim(p_encounter.working_diagnosis), ''), p_encounter.diagnosis_term),
          'coding', (
            select jsonb_agg(c) from (
              select jsonb_build_object('system', 'http://snomed.info/sct',
                                        'code', p_encounter.diagnosis_snomed,
                                        'display', coalesce(p_encounter.diagnosis_term, p_encounter.working_diagnosis)) c
              where coalesce(p_encounter.diagnosis_snomed, '') <> ''
              union all
              select jsonb_build_object('system', 'http://hl7.org/fhir/sid/icd-10',
                                        'code', p_encounter.diagnosis_icd10) c
              where coalesce(p_encounter.diagnosis_icd10, '') <> ''
            ) x)),
        'subject', jsonb_build_object('reference', v_pat_ref),
        'encounter', jsonb_build_object('reference', v_enc_ref),
        'recordedDate', v_recorded)));
    v_cond_refs := jsonb_build_array(jsonb_build_object('reference', v_ref));
  end if;

  -- ---------------------------------------------------------------- allergies
  for r in
    select jsonb_array_elements_text(
             case when jsonb_typeof(coalesce(p_encounter.allergies_fhir, '[]'::jsonb)) = 'array'
                  then p_encounter.allergies_fhir else '[]'::jsonb end) as allergy
  loop
    v_ref := 'urn:uuid:' || gen_random_uuid()::text;
    v_allergies := v_allergies || jsonb_build_array(jsonb_build_object(
      'fullUrl', v_ref,
      'resource', jsonb_build_object(
        'resourceType', 'AllergyIntolerance',
        'id', right(v_ref, 36),
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', 'code', 'active'))),
        'code', jsonb_build_object('text', r.allergy),
        'patient', jsonb_build_object('reference', v_pat_ref),
        'encounter', jsonb_build_object('reference', v_enc_ref),
        'recordedDate', v_recorded)));
    v_allergy_refs := v_allergy_refs || jsonb_build_array(jsonb_build_object('reference', v_ref));
  end loop;

  -- ---------------------------------------------------------------- medications
  for r in
    select * from prescriptions where encounter_id = p_encounter.id order by created_at, id
  loop
    v_ref := 'urn:uuid:' || gen_random_uuid()::text;
    v_meds := v_meds || jsonb_build_array(jsonb_build_object(
      'fullUrl', v_ref,
      'resource', jsonb_build_object(
        'resourceType', 'MedicationRequest',
        'id', right(v_ref, 36),
        -- prescriptions.status is one of ordered / final / finalized / dispensed / cancelled
        'status', case
                    when r.status in ('cancelled', 'canceled') then 'cancelled'
                    when r.status = 'dispensed' then 'completed'
                    when r.status in ('ordered', 'final', 'finalized', 'active') then 'active'
                    else 'draft'
                  end,
        'intent', 'order',
        'medicationCodeableConcept', jsonb_build_object(
          'text', r.medicine_name,
          'coding', case when coalesce(r.active_ingredient_snomed, '') <> ''
                         then jsonb_build_array(jsonb_build_object(
                                'system', 'http://snomed.info/sct',
                                'code', r.active_ingredient_snomed,
                                'display', coalesce(r.active_ingredient_name, r.medicine_name)))
                         else null end),
        'subject', jsonb_build_object('reference', v_pat_ref),
        'encounter', jsonb_build_object('reference', v_enc_ref),
        'authoredOn', public._fhir_instant(r.created_at),
        'requester', case when v_doc_ref is not null
                          then jsonb_build_object('reference', v_doc_ref) end,
        'dosageInstruction', jsonb_build_array(jsonb_build_object(
          'text', concat_ws(' ', nullif(coalesce(r.dosage_text, r.dosage), ''), nullif(r.frequency, ''),
                            nullif(r.duration, ''), nullif(r.instructions, '')))))));
    v_med_refs := v_med_refs || jsonb_build_array(jsonb_build_object('reference', v_ref));
  end loop;

  -- ---------------------------------------------------------------- investigation advice
  for r in
    select * from investigations where encounter_id = p_encounter.id order by created_at, id
  loop
    v_ref := 'urn:uuid:' || gen_random_uuid()::text;
    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'fullUrl', v_ref,
      'resource', jsonb_build_object(
        'resourceType', 'ServiceRequest',
        'id', right(v_ref, 36),
        'status', case when r.status in ('cancelled', 'canceled') then 'revoked'
                       when r.status in ('completed', 'resulted') then 'completed'
                       else 'active' end,
        'intent', 'order',
        'code', jsonb_build_object('text', r.test_name),
        'subject', jsonb_build_object('reference', v_pat_ref),
        'encounter', jsonb_build_object('reference', v_enc_ref),
        'requester', case when v_doc_ref is not null
                          then jsonb_build_object('reference', v_doc_ref) end,
        'authoredOn', public._fhir_instant(r.created_at))));
    v_order_refs := v_order_refs || jsonb_build_array(jsonb_build_object('reference', v_ref));
  end loop;

  -- ---------------------------------------------------------------- sections
  if coalesce(btrim(p_encounter.chief_complaint), '') <> '' or jsonb_array_length(v_cond_refs) > 0 then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'title', 'Chief complaints',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '422843007', 'display', 'Chief complaint section'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">' ||
        coalesce(btrim(p_encounter.chief_complaint), 'Recorded in coded entries') || '</div>'),
      'entry', v_cond_refs));
  end if;

  if jsonb_array_length(v_allergy_refs) > 0 then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'title', 'Allergies',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '722446000', 'display', 'Allergy record'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">Allergies recorded on this encounter</div>'),
      'entry', v_allergy_refs));
  end if;

  if coalesce(btrim(p_encounter.quick_exam), '') <> '' or jsonb_array_length(v_vital_refs) > 0 then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'title', 'Physical examination',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '425044008', 'display', 'Physical exam section'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">' ||
        coalesce(btrim(p_encounter.quick_exam), 'Vital signs recorded') || '</div>'),
      'entry', v_vital_refs));
  end if;

  if jsonb_array_length(v_med_refs) > 0 then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'title', 'Medications',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '721912009', 'display', 'Medication summary document'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">' || jsonb_array_length(v_med_refs)::text ||
        ' medication(s) prescribed</div>'),
      'entry', v_med_refs));
  end if;

  if jsonb_array_length(v_order_refs) > 0 then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'title', 'Investigation advice',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '721963009', 'display', 'Order document'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">Investigations advised on this encounter</div>'),
      'entry', v_order_refs));
  end if;

  if p_encounter.follow_up_date is not null
     or coalesce(btrim(p_encounter.plan_details ->> 'advice_notes'), '') <> '' then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'title', 'Follow up',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '736271009', 'display', 'Outpatient care plan'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">' ||
        coalesce(nullif(btrim(p_encounter.plan_details ->> 'advice_notes'), ''), '') ||
        case when p_encounter.follow_up_date is not null
             then ' Review on ' || p_encounter.follow_up_date::text else '' end || '</div>')));
  end if;

  -- Composition.section is 1..* in the NRCES OP Consult profile: never emit an
  -- empty document for an encounter that has nothing recorded yet.
  if jsonb_array_length(v_sections) = 0 then
    v_sections := jsonb_build_array(jsonb_build_object(
      'title', 'Chief complaints',
      'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://snomed.info/sct', 'code', '422843007', 'display', 'Chief complaint section'))),
      'text', jsonb_build_object('status', 'generated', 'div',
        '<div xmlns="http://www.w3.org/1999/xhtml">No clinical details recorded for this encounter.</div>')));
  end if;

  -- ---------------------------------------------------------------- bundle
  v_entries :=
    jsonb_build_array(
      jsonb_build_object(
        'fullUrl', v_comp_ref,
        'resource', jsonb_build_object(
          'resourceType', 'Composition',
          'id', v_comp_id::text,
          'meta', jsonb_build_object('profile', jsonb_build_array(
            'https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord')),
          'status', case when v_final then 'final' else 'preliminary' end,
          'type', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
              'system', 'http://snomed.info/sct', 'code', '371530004',
              'display', 'Clinical consultation report')), 'text', 'OP Consult Record'),
          'title', 'OP Consult Record',
          'date', public._fhir_instant(coalesce(p_encounter.prescription_finalized_at,
                                                p_encounter.updated_at, p_encounter.created_at)),
          'identifier', jsonb_build_object('system', 'https://docpad.in/encounter',
                                           'value', coalesce(p_encounter.encounter_number, p_encounter.id::text)),
          'subject', jsonb_build_object('reference', v_pat_ref),
          'encounter', jsonb_build_object('reference', v_enc_ref),
          'author', case when v_doc_ref is not null
                         then jsonb_build_array(jsonb_build_object('reference', v_doc_ref))
                         else jsonb_build_array(jsonb_build_object('display', 'DocPad')) end,
          'custodian', case when v_org_ref is not null
                            then jsonb_build_object('reference', v_org_ref) end,
          'section', v_sections))
    )
    || jsonb_build_array(
      jsonb_build_object(
        'fullUrl', v_pat_ref,
        'resource', jsonb_build_object(
          'resourceType', 'Patient',
          'id', p_encounter.patient_id::text,
          'identifier', jsonb_build_array(jsonb_build_object(
              'system', 'https://docpad.in/patient', 'value', coalesce(v_patient.docpad_id, p_encounter.patient_id::text))),
          'name', jsonb_build_array(jsonb_build_object('text', coalesce(v_patient.full_name, 'Unknown'))),
          'gender', case lower(coalesce(v_patient.sex, ''))
                      when 'male' then 'male' when 'm' then 'male'
                      when 'female' then 'female' when 'f' then 'female'
                      else 'unknown' end)),
      jsonb_build_object(
        'fullUrl', v_enc_ref,
        'resource', jsonb_build_object(
          'resourceType', 'Encounter',
          'id', p_encounter.id::text,
          'status', case when v_final then 'finished' else 'in-progress' end,
          'class', jsonb_build_object('system', 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
                                      'code', 'AMB', 'display', 'ambulatory'),
          'subject', jsonb_build_object('reference', v_pat_ref),
          'participant', case when v_doc_ref is not null
                              then jsonb_build_array(jsonb_build_object(
                                     'individual', jsonb_build_object('reference', v_doc_ref))) end,
          'period', jsonb_build_object(
            'start', public._fhir_instant(coalesce(p_encounter.checkin_time, p_encounter.created_at)))
            || case when p_encounter.checkout_time is not null
                    then jsonb_build_object('end', public._fhir_instant(p_encounter.checkout_time))
                    else '{}'::jsonb end,
          'serviceProvider', case when v_org_ref is not null
                                  then jsonb_build_object('reference', v_org_ref) end)))
    || case when v_doc_ref is not null then jsonb_build_array(jsonb_build_object(
         'fullUrl', v_doc_ref,
         'resource', jsonb_build_object(
           'resourceType', 'Practitioner',
           'id', v_doctor.id::text,
           'name', jsonb_build_array(jsonb_build_object('text', coalesce(v_doctor.full_name, 'Practitioner'))),
           'identifier', case when coalesce(v_doctor.registration_no, '') <> ''
                              then jsonb_build_array(jsonb_build_object(
                                     'system', 'https://nmc.org.in/registration', 'value', v_doctor.registration_no)) end)))
       else '[]'::jsonb end
    || case when v_org_ref is not null then jsonb_build_array(jsonb_build_object(
         'fullUrl', v_org_ref,
         'resource', jsonb_build_object(
           'resourceType', 'Organization',
           'id', v_hospital.id::text,
           'name', v_hospital.name,
           'identifier', case when coalesce(v_hospital.hfr_id, '') <> ''
                              then jsonb_build_array(jsonb_build_object(
                                     'system', 'https://facility.abdm.gov.in', 'value', v_hospital.hfr_id)) end)))
       else '[]'::jsonb end
    || v_conditions || v_allergies || v_vitals || v_meds || v_orders;

  return jsonb_build_object(
    'resourceType', 'Bundle',
    'id', p_encounter.id::text,
    'meta', jsonb_build_object(
      'lastUpdated', public._fhir_instant(now()),
      'profile', jsonb_build_array('https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle')),
    'type', 'document',
    'timestamp', public._fhir_instant(now()),
    'identifier', jsonb_build_object('system', 'https://docpad.in/bundle', 'value', p_encounter.id::text),
    'entry', v_entries);
end;
$function$;

comment on function public.build_opd_consult_bundle(public.opd_encounters) is
  'Builds the FHIR R4 OP Consult Record document Bundle for an OPD encounter row.';

-- ---------------------------------------------------------------- read RPC
-- VOLATILE, not STABLE: log_phi_read writes an audit row.
create or replace function public.get_opd_consult_bundle(p_encounter_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_row opd_encounters;
begin
  perform public._assert_hospital_scope('encounter', p_encounter_id);
  perform public.log_phi_read('encounter', p_encounter_id);
  select * into v_row from opd_encounters where id = p_encounter_id;
  if not found then
    return null;
  end if;
  return public.build_opd_consult_bundle(v_row);
end;
$function$;

revoke all on function public.get_opd_consult_bundle(uuid) from public, anon;
grant execute on function public.get_opd_consult_bundle(uuid) to authenticated, service_role;

revoke all on function public.build_opd_consult_bundle(public.opd_encounters) from public, anon;
grant execute on function public.build_opd_consult_bundle(public.opd_encounters) to service_role;

revoke all on function public._fhir_instant(timestamptz) from public, anon;

-- ---------------------------------------------------------------- write trigger
create or replace function public.fn_fhir_opd_encounter()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.fhir_json := public.build_opd_consult_bundle(new);
  return new;
end;
$function$;

-- ---------------------------------------------------------------- active meds
-- finalize_prescription() moves prescriptions to status 'final'; that status was
-- missing from the active-medication filter, so finalised drugs disappeared from
-- the interaction and duplicate checks.
create or replace function public.get_active_medications(p_patient_id uuid, p_exclude_encounter uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result json;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);
  perform public.log_phi_read('patient', p_patient_id);

  select json_agg(row_to_json(m) order by m.prescribed_at desc) into v_result
  from (
    select distinct on (lower(coalesce(p.active_ingredient_name, p.medicine_name)))
      p.id as prescription_id, p.encounter_id, p.medicine_name,
      p.active_ingredient_name as generic_name,
      coalesce(p.dosage_text, p.dosage) as dose,
      p.frequency, p.duration, p.instructions, p.status,
      p.created_at as prescribed_at,
      (p.created_at::date + coalesce(_duration_to_days(p.duration), 30)) as expected_end,
      e.encounter_number,
      (select mr.action from medication_reconciliation mr
        where mr.source_prescription_id = p.id order by mr.created_at desc limit 1) as last_action
    from prescriptions p
    join opd_encounters e on e.id = p.encounter_id
    where p.patient_id = p_patient_id
      and (p_exclude_encounter is null or p.encounter_id <> p_exclude_encounter)
      and coalesce(p.status, 'ordered') in ('ordered', 'dispensed', 'final', 'finalized', 'active')
      and (p.created_at::date + coalesce(_duration_to_days(p.duration), 30)) >= current_date
      and not exists (
        select 1 from medication_reconciliation mr
        where mr.source_prescription_id = p.id and mr.action = 'stop' and mr.created_at > p.created_at)
    order by lower(coalesce(p.active_ingredient_name, p.medicine_name)), p.created_at desc
  ) m;

  return coalesce(v_result, '[]'::json);
end;
$function$;

-- ---------------------------------------------------------------- backfill
-- Re-fires fn_fhir_opd_encounter for every existing encounter so historical
-- rows carry a real document instead of the old three-field stub.
update public.opd_encounters set updated_at = updated_at;
