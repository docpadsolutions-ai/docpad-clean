-- DocPad multi-tenant isolation suite (pgTAP).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rls_isolation.sql
--
-- Everything runs in one transaction that is rolled back, so it is safe to run against any
-- environment. It needs at least two hospitals that each have an active practitioner with a
-- user_id. Hospital A is the one with the most patients; hospital B is another.
begin;

select plan(23);
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

-- ----------------------------------------------------------------- signed-out surface
insert into tap select is((select count(*)::int from information_schema.role_table_grants
  where table_schema='public' and grantee='anon'), 0, 'anon has no table privileges in public');

insert into tap select set_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid,'EXECUTE')$$,
  array['get_public_prescription','get_invitation_by_token','has_permission','get_my_hospital_id','auth_hospital_id'],
  'only the public RPCs and RLS helpers are anon-executable');

insert into tap select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity), 0, 'every table in public has RLS enabled');

insert into tap select alike(pg_temp.as_anon('select count(*) from patients'), 'ERROR%',
  'anon cannot read patients at all');

insert into tap select isnt(pg_temp.as_anon(format('select public.get_public_prescription(%L)',
  (select e.id from opd_encounters e where exists (select 1 from prescriptions p where p.encounter_id=e.id) limit 1))),
  null, 'anon can still open a real prescription link');

insert into tap select is(pg_temp.as_anon('select public.get_public_prescription(gen_random_uuid())'), null,
  'a random prescription link returns nothing');

-- ----------------------------------------------------------------- tenant isolation
insert into tap select is(pg_temp.as_user((select a_user from t_ab),
  format('select count(*) from patients where hospital_id is distinct from %L', (select a_hospital from t_ab))),
  '0', 'no other hospitals patients');

insert into tap select is(pg_temp.as_user((select a_user from t_ab),
  format('select count(*) from opd_encounters where hospital_id is distinct from %L', (select a_hospital from t_ab))),
  '0', 'no other hospitals encounters');

insert into tap select is(pg_temp.as_user((select a_user from t_ab),
  format('select count(*) from prescriptions r join opd_encounters e on e.id=r.encounter_id
          where e.hospital_id is distinct from %L', (select a_hospital from t_ab))),
  '0', 'no other hospitals prescriptions');

insert into tap select is(pg_temp.as_user((select a_user from t_ab),
  format('select count(*) from invoices where hospital_id is distinct from %L', (select a_hospital from t_ab))),
  '0', 'no other hospitals invoices');

insert into tap select is(pg_temp.as_user((select a_user from t_ab),
  format('select count(*) from ipd_admissions where hospital_id is distinct from %L', (select a_hospital from t_ab))),
  '0', 'no other hospitals admissions');

insert into tap select is(pg_temp.as_user((select a_user from t_ab),
  format('select count(*) from storage.objects where (storage.foldername(name))[1] is distinct from %L',
         (select a_hospital::text from t_ab))),
  '0', 'no other hospitals files');

insert into tap select cmp_ok(pg_temp.as_user((select a_user from t_ab),
  'select count(*) from patients')::int, '>', 0, 'own hospitals patients are visible');

-- ----------------------------------------------------------------- privilege escalation
insert into tap select is(pg_temp.as_user_err((select a_user from t_ab),
  'update practitioners set user_role = coalesce(user_role, '''') || ''_admin'' where user_id = auth.uid()'),
  '42501', 'staff cannot promote themselves to admin');

insert into tap select is(pg_temp.as_user_err((select a_user from t_ab),
  'update practitioners set hospital_id = gen_random_uuid() where user_id = auth.uid()'),
  '42501', 'staff cannot move themselves to another hospital');

-- ----------------------------------------------------------------- RPC scope
insert into tap select is(pg_temp.as_user_err((select a_user from t_ab),
  format('select get_patient_header_data(%L)',
         (select id from patients where hospital_id=(select b_hospital from t_ab) limit 1))),
  '42501', 'chart RPCs refuse another hospitals patient');

insert into tap select is(pg_temp.as_user_err((select a_user from t_ab),
  format('select get_patient_header_data(%L)',
         (select id from patients where hospital_id=(select a_hospital from t_ab) limit 1))),
  'none', 'chart RPCs work for own patient');

-- ----------------------------------------------------------------- audit trail
-- (the act and the assertion must be separate statements: one statement cannot see rows
--  written by another part of itself)
create temp table t_audit_before as
select count(*) as writes, count(*) filter (where action='READ') as reads from audit_logs;

select pg_temp.as_user((select a_user from t_ab),
  format('with u as (update patients set blood_group = coalesce(blood_group, ''O+'')
          where hospital_id = %L returning 1) select count(*) from u', (select a_hospital from t_ab)));

select pg_temp.as_user((select a_user from t_ab),
  format('select 1 from (select get_patient_header_data(%L)) z',
         (select id from patients where hospital_id=(select a_hospital from t_ab) limit 1)));

insert into tap select cmp_ok((select count(*) from audit_logs)::int, '>',
  (select writes from t_audit_before)::int, 'a patient edit writes an audit entry');

insert into tap select cmp_ok((select count(*)::int from audit_logs
  where action='UPDATE' and resource_type='patients' and user_id=(select a_user from t_ab)
    and old_values is not null and new_values is not null),
  '>', 0, 'audit entries record who, plus before and after');

insert into tap select cmp_ok((select count(*) filter (where action='READ') from audit_logs)::int, '>',
  (select reads from t_audit_before)::int, 'opening a chart writes a READ entry');

-- ----------------------------------------------------------------- audit log is append-only (SOW 2.1)
insert into audit_logs (hospital_id, action, resource_type) values (null, 'TAP_TEST', 'tap');

insert into tap select throws_ok(
  'update audit_logs set action = ''TAMPERED'' where action = ''TAP_TEST''',
  '42501', null, 'audit entries cannot be updated, even by the owner');

insert into tap select throws_ok(
  'delete from audit_logs where action = ''TAP_TEST''',
  '42501', null, 'audit entries cannot be deleted, even by the owner');

-- ----------------------------------------------------------------- prescribing safety (SOW 2.2)
create temp table t_rx as
select e.id as encounter_id, e.patient_id
from opd_encounters e
where e.hospital_id = (select a_hospital from t_ab) and e.patient_id is not null
limit 1;

insert into prescriptions (encounter_id, patient_id, medicine_name, active_ingredient_name,
                           dosage, frequency, duration, status, created_at)
select encounter_id, patient_id, 'TAP ACTIVE DRUG', 'Ciprofloxacin', '500mg', 'BD', '5 days', 'dispensed', now()
from t_rx;

insert into tap select cmp_ok(
  json_array_length(
    pg_temp.as_user((select a_user from t_ab),
      format('select public.check_prescription_safety(%L, %L::jsonb)', (select patient_id from t_rx),
             '[{"medicine_name":"TAP NEW BRAND","generic_name":"Ciprofloxacin"}]'))::json -> 'duplicates')::int,
  '>', 0, 'prescribing the same generic again raises duplicate therapy');

-- ----------------------------------------------------------------- report
select l from tap where l like 'not ok%';
select coalesce((select string_agg(l, E'\n') from tap where l like 'not ok%'),
                'ALL PASS: ' || (select count(*) from tap) || ' tests') as result;
select * from finish();

rollback;
