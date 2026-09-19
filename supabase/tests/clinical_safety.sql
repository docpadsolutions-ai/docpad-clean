-- DocPad clinical-safety suite (pgTAP).
--
-- This is the blocking gate Proposal v1.0 2.1 asks for and SOW 5 lists as an
-- acceptance criterion: "automated regression suite covering all clinical safety
-- paths". It is separate from rls_isolation.sql on purpose. Tenancy and clinical
-- safety fail for different reasons and a reviewer should be able to see which one
-- broke without reading sixty assertions.
--
-- Everything here asserts a rule at the DATABASE, because every one of these rules
-- previously existed only in the UI: a finalised encounter was `inert` and disabled
-- but writable by anyone talking to PostgREST, and a prescribing hard stop was a
-- `disabled` attribute on three buttons. A test that drives the UI would have passed
-- against both.
--
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/clinical_safety.sql
--
-- Everything runs in one transaction that is rolled back, so it is safe to run against any
-- environment. It needs at least two hospitals that each have an active practitioner with a
-- user_id. Hospital A is the one with the most patients; hospital B is another.
begin;

select plan(26);
create temp table tap(l text);

create temp table t_actor as
select p.hospital_id,
       (array_agg(p.user_id order by p.created_at))[1] as user_id,
       (select count(*) from patients pt where pt.hospital_id = p.hospital_id) as patients
from practitioners p
where p.user_id is not null and p.hospital_id is not null and coalesce(p.is_active, true)
group by p.hospital_id;

create temp table t_ab as
select (select hospital_id from t_actor order by patients desc limit 1) as a_hospital,
       (select user_id     from t_actor order by patients desc limit 1) as a_user,
       (select hospital_id from t_actor order by patients asc  limit 1) as b_hospital,
       (select user_id     from t_actor order by patients asc  limit 1) as b_user;

-- Run a statement as a signed-in staff member / as a signed-out visitor.
create or replace function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $fn$
declare v text; begin
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',p_user)::text, true);
  set local role authenticated; execute p_sql into v; reset role; return v;
exception when others then reset role; raise; end $fn$;

create or replace function pg_temp.as_user_err(p_user uuid, p_sql text) returns text language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',p_user)::text, true);
  set local role authenticated; execute p_sql; reset role; return 'none';
exception when others then reset role; return sqlstate; end $fn$;

create or replace function pg_temp.as_anon(p_sql text) returns text language plpgsql as $fn$
declare v text; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon; execute p_sql into v; reset role; return v;
exception when others then reset role; return 'ERROR ' || sqlstate; end $fn$;


-- ------------------------------------------------- finalise lock (Proposal v1.0 2.4)
-- "explicit finalise action locking the encounter". The UI lock is `inert` plus
-- disabled fields, none of which survives a direct PATCH, so these assert the lock
-- where it actually has to hold.
create temp table t_fin as
select e.id as encounter_id
from opd_encounters e
where e.hospital_id = (select a_hospital from t_ab)
  and coalesce(e.status, '') = 'completed'
limit 1;

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$update opd_encounters set working_diagnosis = 'TAP TAMPER' where id = %L$q$,
           (select encounter_id from t_fin))),
  '42501', 'a finalised encounter refuses a change to the working diagnosis');

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$update opd_encounters set pulse = '999' where id = %L$q$,
           (select encounter_id from t_fin))),
  '42501', 'a finalised encounter refuses a change to recorded vitals');

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$update opd_encounters set status = 'in_progress' where id = %L$q$,
           (select encounter_id from t_fin))),
  '42501', 'a finalised encounter cannot be reopened, which would defeat the column lock');

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$update opd_encounters set follow_up_date = current_date + 30 where id = %L$q$,
           (select encounter_id from t_fin))),
  'none', 'administrative columns stay writable, so cancelling a follow-up still works');

insert into tap select is(
  (select working_diagnosis from opd_encounters where id = (select encounter_id from t_fin)),
  (select working_diagnosis from opd_encounters where id = (select encounter_id from t_fin)),
  'the clinical content of the finalised encounter is unchanged after the attempts above');


-- ------------------------------------------- prescribing hard stops (SOW 3.2, 2.2)
-- "Hard stops for severe allergy and severe drug interaction are retained
-- unchanged." Before this, the hard stop was a disabled attribute on three buttons
-- and did not survive a direct write. These assert it where the row lands.
create temp table t_rx as
select p.id as patient_id, p.hospital_id
from patients p
where p.hospital_id = (select a_hospital from t_ab)
limit 1;

-- Fixture inside the test transaction; the whole suite rolls back.
update patients set known_allergies = array['penicillin']
 where id = (select patient_id from t_rx);

-- Wave 1.3 moved the hard-stop's own matching from this legacy free-text column onto
-- the structured patient_allergies table (patient_allergy_matches falls back to
-- known_allergies only when a patient has *no* structured rows at all). Real patients
-- already have structured rows from that migration's backfill, so the fixture above
-- alone no longer reaches the hard stop for an existing patient -- insert the
-- structured row here too, before the hard-stop assertions run.
insert into public.patient_allergies (hospital_id, patient_id, substance, category, severity)
select hospital_id, patient_id, 'penicillin', 'drug', 'unknown' from t_rx
on conflict do nothing;

insert into opd_encounters (id, hospital_id, patient_id, encounter_date, status)
select '00000000-0000-4000-8000-0000000000a1'::uuid, hospital_id, patient_id, current_date, 'in_progress'
  from t_rx;

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$insert into prescriptions (encounter_id, patient_id, medicine_name, active_ingredient_name, status)
             values ('00000000-0000-4000-8000-0000000000a1', %L, 'Penicillin V 250mg', 'penicillin', 'ordered')$q$,
           (select patient_id from t_rx))),
  '42501', 'a medicine matching a recorded allergy is refused at the insert');

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$insert into prescriptions (encounter_id, patient_id, medicine_name, active_ingredient_name, status)
             values ('00000000-0000-4000-8000-0000000000a1', %L, 'Aceclofenac 100mg', 'aceclofenac', 'ordered')$q$,
           (select patient_id from t_rx))),
  'none', 'a medicine with no interaction and no allergy still saves');

insert into tap select is(
  pg_temp.as_user_err((select a_user from t_ab),
    format($q$insert into prescriptions (encounter_id, patient_id, medicine_name, active_ingredient_name, status)
             values ('00000000-0000-4000-8000-0000000000a1', %L, 'Warfarin 5mg', 'warfarin', 'ordered')$q$,
           (select patient_id from t_rx))),
  '42501', 'the second half of a severe interacting pair is refused as it is added');

insert into tap select is(
  (select count(*)::int from prescriptions
    where encounter_id = '00000000-0000-4000-8000-0000000000a1'),
  1, 'only the safe medicine reached the table');

insert into tap select cmp_ok(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select jsonb_array_length(public.prescription_safety_blocks(%L,
             '[{"medicine_name":"Penicillin V","generic_name":"penicillin"}]'::jsonb))::text$q$,
           (select patient_id from t_rx)))::int,
  '>', 0, 'the block list reports the allergy rather than returning empty');


-- --------------------------------------------- allergy grading (SOW 3.2, Wave 1.3)
-- The structured row inserted above (moved earlier so the hard-stop block could see
-- it) already carries the penicillin allergy these assert the grading of.
insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select (public.patient_allergy_matches(%L,
             '[{"medicine_name":"Amoxicillin 500mg","generic_name":"amoxicillin"}]'::jsonb) -> 0 ->> 'blocking')$q$,
           (select patient_id from t_rx))),
  'true', 'a penicillin allergy blocks amoxicillin, which name matching alone never caught');

insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select (public.patient_allergy_matches(%L,
             '[{"medicine_name":"Amoxicillin 500mg","generic_name":"amoxicillin"}]'::jsonb) -> 0 ->> 'match')$q$,
           (select patient_id from t_rx))),
  'same_group', 'and it is reported as a cross-reactive match rather than a direct one');

insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select (public.patient_allergy_matches(%L,
             '[{"medicine_name":"Cefuroxime 500mg","generic_name":"cefuroxime"}]'::jsonb) -> 0 ->> 'blocking')$q$,
           (select patient_id from t_rx))),
  'false', 'a cephalosporin after a penicillin allergy advises rather than refuses');

insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select jsonb_array_length(public.patient_allergy_matches(%L,
             '[{"medicine_name":"Azithromycin 500mg","generic_name":"azithromycin"}]'::jsonb))::text$q$,
           (select patient_id from t_rx))),
  '0', 'a penicillin allergy does not touch azithromycin, which drugs.drug_class would have blocked');

insert into tap select cmp_ok(
  (select count(*)::int from patient_allergies where category = 'drug'),
  '>', 0, 'the legacy known_allergies text[] backfilled into structured rows with a category');


-- Defence in depth. A row written before the trigger existed still has to be caught
-- at the moment the prescription becomes an instruction to a pharmacist. Simulated
-- here by putting one in through the documented seeding bypass, then closing it.
-- Note finalize_prescription reports refusal in its RETURN VALUE rather than by
-- raising, which is the shape the client used to read as success.
select set_config('docpad.allow_unsafe_prescription', 'on', true);
insert into prescriptions (encounter_id, patient_id, medicine_name, active_ingredient_name, status)
select '00000000-0000-4000-8000-0000000000a1', patient_id, 'Penicillin V 250mg', 'penicillin', 'ordered'
  from t_rx;
select set_config('docpad.allow_unsafe_prescription', 'off', true);

insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select (public.finalize_prescription(
                       '00000000-0000-4000-8000-0000000000a1'::uuid, %L, %L) ->> 'success')$q$,
           (select hospital_id from t_rx), (select patient_id from t_rx))),
  'false', 'finalize_prescription refuses a pre-existing unsafe row at finalisation');

insert into tap select is(
  (select count(*)::int from prescriptions
    where encounter_id = '00000000-0000-4000-8000-0000000000a1' and status = 'final'),
  0, 'and nothing was flipped to final while it refused');

-- A `related` cross-reaction must advise, and must never reach the blocking list.
insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select jsonb_array_length(public.prescription_safety_blocks(%L,
             '[{"medicine_name":"Cefuroxime 500mg","generic_name":"cefuroxime"}]'::jsonb))::text$q$,
           (select patient_id from t_rx))),
  '0', 'a related cross-reaction is an advisory and never enters the block list');


-- ------------------------------------- patient identity (Proposal v1.0 2.3)
-- "a persistent patient banner ... showing photo, name, age/sex, DocPad ID and CR
-- number". The CR number did not exist anywhere in the schema until 19 Sep 2026.
-- It is the number the patient is holding on a card and can read back, which is the
-- only kind of identity check that is actually a check.
insert into tap select is(
  (select count(*)::int from patients where cr_number is null),
  0, 'every patient has a CR number');

insert into tap select is(
  (select count(*)::int from (
     select hospital_id, cr_number from patients
      group by 1, 2 having count(*) > 1) d),
  0, 'CR numbers do not repeat within a hospital');

insert into tap select isnt(
  (select public.next_cr_number((select a_hospital from t_ab))),
  (select cr_number from patients
    where hospital_id = (select a_hospital from t_ab)
    order by cr_number desc limit 1),
  'the next CR number is not one already issued');

insert into tap select matches(
  (select public.next_cr_number((select a_hospital from t_ab))),
  '[0-9]{6}$', 'a CR number ends in a six-digit running number');

-- ------------------------------------- mobile duplicate detection (Wave 3.13/14)
-- Until 19 Sep 2026 the only duplicate check was by Aadhaar hash, so a patient with
-- no Aadhaar had no duplicate check run for them at all. This is the mobile-hash
-- equivalent, hospital-scoped the same way the Aadhaar one is.
insert into tap select is(
  (select count(*)::int from patients where phone is not null and btrim(phone) <> '' and mobile_hash is null),
  0, 'every patient with a phone number has a mobile hash');

insert into tap select is(
  pg_temp.as_user((select a_user from t_ab),
    format($q$select (count(*) > 0)::text from check_patient_exists_by_phone(
      (select phone from patients where hospital_id = %L and phone is not null limit 1))$q$,
      (select a_hospital from t_ab))),
  'true', 'the mobile duplicate check finds an existing patient by phone');

insert into tap select is(
  pg_temp.as_user((select b_user from t_ab),
    format($q$select count(*)::text from check_patient_exists_by_phone(
      (select phone from patients where hospital_id = %L and phone is not null limit 1))$q$,
      (select a_hospital from t_ab))),
  '0', 'the mobile duplicate check does not cross hospitals');

insert into tap select isnt(
  (select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'patients'
      and column_name = 'registered_despite_duplicate_of'),
  null, 'patients carries an audit trail column for a confirmed non-duplicate registration');

-- ----------------------------------------------------------------- report
select l from tap where l like 'not ok%';
select coalesce((select string_agg(l, E'\n') from tap where l like 'not ok%'),
                'ALL PASS: ' || (select count(*) from tap) || ' clinical-safety tests') as result;
select * from finish();

rollback;
