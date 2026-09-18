-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917170425.

-- 1. JWT has no hospital_id claim (no custom access-token hook), so these policies never matched.
alter policy hospital_auth_tokens on public.abdm_auth_tokens to authenticated
  using (hospital_id = (select auth_hospital_id())) with check (hospital_id = (select auth_hospital_id()));
alter policy hospital_subscriptions on public.abdm_subscriptions to authenticated
  using (hospital_id = (select auth_hospital_id())) with check (hospital_id = (select auth_hospital_id()));
alter policy vendors_hospital_scope on public.vendors to authenticated
  using (hospital_id = (select auth_hospital_id())) with check (hospital_id = (select auth_hospital_id()));
alter policy hospital_consents on public.abdm_consent_requests to authenticated
  using (patient_hospital_id(patient_id) = (select auth_hospital_id()))
  with check (patient_hospital_id(patient_id) = (select auth_hospital_id()));
alter policy hospital_abha_sessions on public.abha_sessions to authenticated
  using (patient_hospital_id(patient_id) = (select auth_hospital_id()))
  with check (patient_hospital_id(patient_id) = (select auth_hospital_id()));
alter policy hospital_hi_transfers on public.hi_data_transfers to authenticated
  using (patient_hospital_id(patient_id) = (select auth_hospital_id()))
  with check (patient_hospital_id(patient_id) = (select auth_hospital_id()));
alter policy hospital_hip_links on public.hip_link_requests to authenticated
  using (patient_hospital_id(patient_id) = (select auth_hospital_id()))
  with check (patient_hospital_id(patient_id) = (select auth_hospital_id()));
alter policy hospital_staff_insurance_config on public.hospital_insurance_config to authenticated
  using (hospital_id = (select auth_hospital_id())) with check (hospital_id = (select auth_hospital_id()));

-- 2. Duplicate permissive policies.
drop policy "Recipients see own notifications" on public.notifications;      -- subset of notif_select
drop policy "Recipients update own notifications" on public.notifications;   -- subset of notif_update

drop policy test_catalogue_access on public.test_catalogue;
alter policy catalogue_readable on public.test_catalogue to authenticated;
create policy test_catalogue_insert on public.test_catalogue for insert to authenticated
  with check (hospital_id = (select get_my_hospital_id()));
create policy test_catalogue_update on public.test_catalogue for update to authenticated
  using (hospital_id = (select get_my_hospital_id())) with check (hospital_id = (select get_my_hospital_id()));
create policy test_catalogue_delete on public.test_catalogue for delete to authenticated
  using (hospital_id = (select get_my_hospital_id()));
alter policy presets_readable on public.investigation_presets to authenticated;

drop policy xray_tpl_write on public.xray_measurement_templates;
create policy xray_tpl_insert on public.xray_measurement_templates for insert to authenticated
  with check (hospital_id = (select get_my_hospital_id())
              and doctor_id in (select id from practitioners where user_id = (select auth.uid())));
create policy xray_tpl_update on public.xray_measurement_templates for update to authenticated
  using (hospital_id = (select get_my_hospital_id())
         and doctor_id in (select id from practitioners where user_id = (select auth.uid())))
  with check (hospital_id = (select get_my_hospital_id())
              and doctor_id in (select id from practitioners where user_id = (select auth.uid())));
create policy xray_tpl_delete on public.xray_measurement_templates for delete to authenticated
  using (hospital_id = (select get_my_hospital_id())
         and doctor_id in (select id from practitioners where user_id = (select auth.uid())));

-- 3. Evaluate auth.*() and the hospital helpers once per statement instead of once per row.
do $$
declare
  r record;
  pat constant text := '(?<!SELECT )(auth\.(uid|role|jwt)|get_my_hospital_id|auth_hospital_id)\(\)';
  rep constant text := '(select \1())';
  new_q text;
  new_c text;
  stmt text;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    new_q := case when r.qual is not null then regexp_replace(r.qual, pat, rep, 'g') end;
    new_c := case when r.with_check is not null then regexp_replace(r.with_check, pat, rep, 'g') end;
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if new_q is not null then stmt := stmt || format(' using (%s)', new_q); end if;
    if new_c is not null then stmt := stmt || format(' with check (%s)', new_c); end if;
    execute stmt;
  end loop;
end
$$;
