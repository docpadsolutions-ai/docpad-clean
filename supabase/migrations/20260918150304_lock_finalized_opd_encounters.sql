-- Wave 1.1 - make the encounter lock real.
--
-- The UI locks a finalised encounter convincingly: the chart is wrapped in `inert`,
-- a "Finalized" badge appears, every field is disabled. None of that survives a
-- direct PATCH. The RLS update policy on opd_encounters carries no status predicate,
-- and none of the six triggers on the table blocks a write to a completed row, so
-- any client holding a valid session can edit a finalised clinical record.
--
-- The SOW asks for "explicit finalise action locking the encounter". A disabled
-- input is not a lock; it is a suggestion. IPD discharge summaries already raise an
-- exception on exactly this, so the pattern is established in this codebase - it was
-- simply never applied to OPD.
--
-- Two things are blocked once status is completed/final/finalized:
--   1. any change to a clinical column (the list below), and
--   2. moving status back to a non-final value, which would otherwise unlock the row
--      and make rule 1 trivially bypassable.
--
-- Administrative columns stay writable on purpose. Cancelling a follow-up legitimately
-- clears follow_up_date on a finalised encounter; payment and token state move after
-- the clinician is done; fhir_json is recomputed by the projection trigger on every
-- write. Locking those would break working flows without protecting anything clinical.
--
-- Amendments are deliberately NOT an update. Under DPDPA 2.3 and the append-only
-- audit trail of 2.1, correcting a clinical record is a new entry, not an overwrite.
-- The escape hatch below exists for data migrations only and is per-transaction.

create or replace function public.trg_lock_finalized_encounter()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Everything a clinician authored. Anything not on this list is administrative.
  locked_cols constant text[] := array[
    'patient_id', 'encounter_date', 'visit_type',
    'chief_complaint', 'chief_complaint_snomed', 'chief_complaint_term',
    'chief_complaint_concept_id', 'chief_complaints_fhir',
    'complaints_snomed', 'complaints_term',
    'working_diagnosis', 'working_diagnosis_snomed', 'diagnosis_fhir',
    'diagnosis_sctid', 'diagnosis_icd10', 'diagnosis_term',
    'diagnosis_concept_id', 'diagnosis_snomed',
    'quick_exam', 'quick_exam_snomed', 'examination_snomed', 'examination_term',
    'plan_procedures', 'plan_procedures_snomed', 'procedures_fhir', 'plan_details',
    'clinical_notes', 'allergies_fhir',
    'weight', 'blood_pressure', 'pulse', 'temperature', 'spo2'
  ];
  final_states constant text[] := array['completed', 'final', 'finalized', 'finalised'];
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb := to_jsonb(NEW);
  changed text[] := '{}';
  c text;
begin
  -- Not finalised yet: nothing to protect.
  if coalesce(OLD.status, '') <> all (final_states) then
    return NEW;
  end if;

  -- Escape hatch for data migrations run deliberately by a human. Per-transaction,
  -- never set by the application, and the write is still captured by zz_audit_row.
  if coalesce(current_setting('docpad.amend_finalized', true), '') = 'on' then
    return NEW;
  end if;

  -- Reopening a finalised encounter would make the column lock pointless.
  if coalesce(NEW.status, '') <> all (final_states) then
    raise exception
      'This encounter is finalised and cannot be reopened. Record a new encounter instead.'
      using errcode = '42501';
  end if;

  foreach c in array locked_cols loop
    if (old_j -> c) is distinct from (new_j -> c) then
      changed := changed || c;
    end if;
  end loop;

  if array_length(changed, 1) > 0 then
    raise exception
      'This encounter is finalised. % cannot be changed; record an amendment as a new entry.',
      array_to_string(changed, ', ')
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

comment on function public.trg_lock_finalized_encounter() is
  'Enforces the finalise lock the UI only implied. Blocks clinical edits and reopening of a completed encounter. Bypass for data migrations: set_config(''docpad.amend_finalized'', ''on'', true).';

-- Named to sort first among the BEFORE UPDATE triggers, so the caller's submitted
-- values are judged before normalize_encounter_doctor_id or the FHIR projection
-- rewrite anything.
drop trigger if exists aa_lock_finalized_encounter on public.opd_encounters;
create trigger aa_lock_finalized_encounter
  before update on public.opd_encounters
  for each row execute function public.trg_lock_finalized_encounter();
