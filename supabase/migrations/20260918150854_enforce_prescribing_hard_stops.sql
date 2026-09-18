-- Wave 1.2 - enforce the prescribing hard stop where the write happens.
--
-- The two-tier alert design of SOW 3.2 keeps hard stops for severe allergy and
-- severe drug interaction "unchanged". In the build, a hard stop is a `disabled`
-- attribute on three buttons in PrescriptionModal. It is absent from
-- handleFinalizePrescription, from handleWhatsAppSend, from finalize_prescription
-- and from the prescriptions insert. A greyed-out button is not a hard stop: the
-- row writes normally for anything that talks to PostgREST directly, and the UI
-- makes that impossible to notice.
--
-- The check now runs in two places, deliberately overlapping:
--   * a BEFORE INSERT/UPDATE trigger on prescriptions, which is the actual write
--     path, and
--   * inside finalize_prescription, which catches rows that predate this migration.
--
-- Scope note, honestly stated. This enforces exactly what the UI already claimed,
-- no more: severe and contraindicated interactions from drug_interactions, and an
-- allergy match by the same bidirectional substring rule the client uses. Two known
-- weaknesses are NOT fixed here and are Wave 1.3:
--   * drug_interactions holds 24 pairs, so silence is not clearance.
--   * allergy matching is by name, so "penicillin" on file does not catch
--     amoxicillin. Class-level matching needs an ingredient-to-class map, and
--     allergy severity needs a structured patient_allergies table, since
--     patients.known_allergies is a bare text[] with no severity at all.
-- Enforcing the weak rule at the database is still strictly better than enforcing
-- nothing, and it is the precondition for strengthening the rule later in one place.

create or replace function public.prescription_safety_blocks(
  p_patient_id        uuid,
  p_medicines         jsonb,
  p_exclude_encounter uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_safety   json;
  v_blocks   jsonb := '[]'::jsonb;
  v_allergies text[];
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  if p_medicines is null or jsonb_array_length(p_medicines) = 0 then
    return v_blocks;
  end if;

  -- Interactions, including against the patient's existing active medications.
  v_safety := public.check_prescription_safety(p_patient_id, p_medicines, p_exclude_encounter);

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'interaction',
           'severity', i ->> 'severity',
           'drug_a', i ->> 'drug_a',
           'drug_b', i ->> 'drug_b',
           'detail', coalesce(i ->> 'clinical_effect', i ->> 'description'),
           'management', i ->> 'management')), '[]'::jsonb)
    into v_blocks
    from jsonb_array_elements((v_safety::jsonb) -> 'interactions') i
   where lower(coalesce(i ->> 'severity', '')) in ('severe', 'contraindicated');

  -- Allergies. Same bidirectional substring rule the client applies, so the server
  -- enforces the promise the UI is already making rather than a different one.
  select array_agg(lower(btrim(a))) into v_allergies
    from patients p, unnest(coalesce(p.known_allergies, '{}')) a
   where p.id = p_patient_id and btrim(a) <> '';

  if v_allergies is not null then
    v_blocks := v_blocks || coalesce((
      select jsonb_agg(distinct jsonb_build_object(
               'kind', 'allergy',
               'severity', 'unknown',
               'allergen', al,
               'drug', med,
               'detail', 'The patient has a recorded allergy that matches this medicine.'))
        from jsonb_array_elements(p_medicines) m,
             lateral (select lower(btrim(coalesce(
                        nullif(m ->> 'medicine_name', ''),
                        m ->> 'generic_name'))) as med,
                             lower(btrim(coalesce(
                        nullif(m ->> 'generic_name', ''),
                        m ->> 'medicine_name'))) as gen) x,
             unnest(v_allergies) al
       where med <> '' and (
             med like '%' || al || '%' or al like '%' || med || '%'
          or gen like '%' || al || '%' or al like '%' || gen || '%')
    ), '[]'::jsonb);
  end if;

  return v_blocks;
end;
$function$;

revoke all on function public.prescription_safety_blocks(uuid, jsonb, uuid) from public, anon;
grant execute on function public.prescription_safety_blocks(uuid, jsonb, uuid) to authenticated, service_role;

comment on function public.prescription_safety_blocks(uuid, jsonb, uuid) is
  'The hard-stop half of the two-tier alert design: severe/contraindicated interactions and allergy matches. Returns [] when nothing blocks. Advisories are deliberately not returned here.';


create or replace function public.trg_block_unsafe_prescription()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_meds   jsonb;
  v_blocks jsonb;
  v_first  jsonb;
begin
  -- Dispensing, cancelling and status changes must not be re-litigated; only the
  -- act of putting a medicine on the prescription is checked.
  if TG_OP = 'UPDATE'
     and NEW.medicine_name is not distinct from OLD.medicine_name
     and NEW.active_ingredient_name is not distinct from OLD.active_ingredient_name then
    return NEW;
  end if;

  -- Documented bypass for seeding and data migration, per transaction. The row is
  -- still captured by the audit trigger.
  if coalesce(current_setting('docpad.allow_unsafe_prescription', true), '') = 'on' then
    return NEW;
  end if;

  if NEW.patient_id is null then
    return NEW;
  end if;

  -- The row being written, plus the rest of this encounter's prescription, so a
  -- contraindicated pair is caught as the second drug lands.
  select coalesce(jsonb_agg(jsonb_build_object(
           'medicine_name', medicine_name,
           'generic_name', active_ingredient_name)), '[]'::jsonb)
    into v_meds
    from (
      select NEW.medicine_name as medicine_name,
             NEW.active_ingredient_name as active_ingredient_name
      union all
      select r.medicine_name, r.active_ingredient_name
        from prescriptions r
       where r.encounter_id is not null
         and r.encounter_id = NEW.encounter_id
         and r.id is distinct from NEW.id
         and coalesce(r.status, '') in ('ordered', 'final')
    ) s;

  v_blocks := public.prescription_safety_blocks(NEW.patient_id, v_meds, NEW.encounter_id);

  if jsonb_array_length(v_blocks) > 0 then
    v_first := v_blocks -> 0;
    if v_first ->> 'kind' = 'allergy' then
      raise exception
        'Blocked: % is recorded as an allergy for this patient (matched "%").',
        v_first ->> 'drug', v_first ->> 'allergen'
        using errcode = '42501',
              hint = 'Recorded allergies are a hard stop. Remove the medicine or correct the allergy record.';
    else
      raise exception
        'Blocked: % interaction between % and %. %',
        v_first ->> 'severity', v_first ->> 'drug_a', v_first ->> 'drug_b',
        coalesce(v_first ->> 'management', '')
        using errcode = '42501',
              hint = 'Severe and contraindicated interactions are a hard stop.';
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists aa_block_unsafe_prescription on public.prescriptions;
create trigger aa_block_unsafe_prescription
  before insert or update on public.prescriptions
  for each row execute function public.trg_block_unsafe_prescription();


-- Defence in depth: rows written before this migration existed are still caught at
-- the moment the prescription becomes a real instruction to a pharmacist.
create or replace function public.finalize_prescription(
  encounter_id uuid,
  hospital_id  uuid,
  patient_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_practitioner_id uuid;
  v_count           int := 0;
  v_meds            jsonb;
  v_blocks          jsonb;
  v_first           jsonb;
begin
  select id into v_practitioner_id
    from practitioners where user_id = auth.uid();

  if v_practitioner_id is null then
    return jsonb_build_object('success', false, 'error', 'Practitioner not found');
  end if;

  select count(*) into v_count
    from prescriptions
   where prescriptions.encounter_id = finalize_prescription.encounter_id
     and status = 'ordered';

  if v_count = 0 then
    return jsonb_build_object('success', false, 'error', 'No medications to finalize');
  end if;

  if coalesce(current_setting('docpad.allow_unsafe_prescription', true), '') <> 'on' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'medicine_name', r.medicine_name,
             'generic_name', r.active_ingredient_name)), '[]'::jsonb)
      into v_meds
      from prescriptions r
     where r.encounter_id = finalize_prescription.encounter_id
       and coalesce(r.status, '') in ('ordered', 'final');

    v_blocks := public.prescription_safety_blocks(
                  finalize_prescription.patient_id, v_meds,
                  finalize_prescription.encounter_id);

    if jsonb_array_length(v_blocks) > 0 then
      v_first := v_blocks -> 0;
      return jsonb_build_object(
        'success', false,
        'error', 'blocked_by_safety',
        'blocks', v_blocks,
        'message', case when v_first ->> 'kind' = 'allergy'
                     then format('%s is recorded as an allergy for this patient.', v_first ->> 'drug')
                     else format('%s interaction between %s and %s.',
                                 initcap(v_first ->> 'severity'),
                                 v_first ->> 'drug_a', v_first ->> 'drug_b') end);
    end if;
  end if;

  update prescriptions
     set status       = 'final',
         finalized_at = now(),
         finalized_by = v_practitioner_id
   where prescriptions.encounter_id = finalize_prescription.encounter_id
     and status = 'ordered';

  update opd_encounters
     set prescription_finalized_at = now(),
         prescription_finalized_by = v_practitioner_id
   where id = finalize_prescription.encounter_id;

  return jsonb_build_object(
    'success', true,
    'drugs_finalized', v_count,
    'message', 'Prescription finalized and sent to pharmacy');
end;
$function$;
