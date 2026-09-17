-- Rollback for the 2026-09-17 security hardening migrations (20260917165444 … 20260917171115).
-- Run sections selectively in the SQL editor if something the app needs was blocked.
-- WARNING: most sections re-open real security holes. Prefer fixing forward.

-----------------------------------------------------------------------------------------------
-- A. rpc_hospital_scope_guards: strip the injected _assert_hospital_scope() lines
-----------------------------------------------------------------------------------------------
do $$
declare f record; def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%_assert_hospital_scope(%'
      and p.proname not in ('_assert_hospital_scope', 'ensure_daily_progress_notes')
  loop
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, E'\\n  perform public\\._assert_hospital_scope\\([^;]*\\);', '', 'g');
    def := regexp_replace(def, E'\\nselect public\\._assert_hospital_scope\\([^;]*\\);', '', 'g');
    execute def;
  end loop;
end $$;

-----------------------------------------------------------------------------------------------
-- B. tighten_table_grants: give anon back its default table/sequence privileges
-----------------------------------------------------------------------------------------------
-- grant all on all tables in schema public to anon;
-- grant all on all sequences in schema public to anon;
-- grant truncate, trigger, references on all tables in schema public to authenticated;
-- alter default privileges for role postgres in schema public grant all on tables to anon;
-- alter default privileges for role postgres in schema public grant all on sequences to anon;

-----------------------------------------------------------------------------------------------
-- C. revoke_anon_execute_security_definer: re-grant anon EXECUTE on every SECURITY DEFINER fn
-----------------------------------------------------------------------------------------------
-- do $$ declare r record; begin
--   for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.prosecdef loop
--     execute format('grant execute on function %s to anon, authenticated', r.sig);
--   end loop; end $$;
-- alter default privileges for role postgres in schema public grant execute on functions to public, anon;

-----------------------------------------------------------------------------------------------
-- D. practitioners privilege guard
-----------------------------------------------------------------------------------------------
-- drop trigger if exists practitioners_protect_privileged_columns on public.practitioners;

-----------------------------------------------------------------------------------------------
-- E. tenant_scope_patient_rls: original (hospital-unscoped) policies
-----------------------------------------------------------------------------------------------
-- alter policy "View patients by role" on public.patients to public using (has_permission(auth.uid(), 'patients', 'read'));
-- alter policy "Create patients by role" on public.patients to public with check (has_permission(auth.uid(), 'patients', 'create'));
-- alter policy "Update patients by role" on public.patients to public using (has_permission(auth.uid(), 'patients', 'update'));
-- alter policy "View prescriptions by role" on public.prescriptions to public using (has_permission(auth.uid(), 'prescriptions', 'read'));
-- alter policy "Create prescriptions by role" on public.prescriptions to public with check (has_permission(auth.uid(), 'prescriptions', 'create'));
-- alter policy "Update prescriptions by role" on public.prescriptions to public using (has_permission(auth.uid(), 'prescriptions', 'update'));
-- alter policy "View vitals by role" on public.vitals to public using (has_permission(auth.uid(), 'vitals', 'read'));
-- alter policy "Create vitals by role" on public.vitals to public with check (has_permission(auth.uid(), 'vitals', 'create'));
-- alter policy "Update vitals by role" on public.vitals to public using (has_permission(auth.uid(), 'vitals', 'update'));
-- create policy "View inventory by role" on public.hospital_inventory for select to public using (has_permission(auth.uid(), 'hospital_inventory', 'read'));
-- alter policy "Create inventory by role" on public.hospital_inventory to public with check (has_permission(auth.uid(), 'hospital_inventory', 'create'));
-- alter policy "Update inventory by role" on public.hospital_inventory to public using (has_permission(auth.uid(), 'hospital_inventory', 'update'));
-- create policy "Users can view accounts in their hospital" on public.accounts for select to public
--   using (hospital_id in (select practitioners.hospital_id from practitioners where practitioners.id = auth.uid()));
-- alter policy "Users can manage accounts in their hospital" on public.accounts to public
--   using (hospital_id in (select practitioners.hospital_id from practitioners where practitioners.id = auth.uid()));
-- alter policy authenticated_select on public.clinical_procedure_consents using (true);

-----------------------------------------------------------------------------------------------
-- F. rls_policy_performance_and_cleanup: original policies that changed meaning
-----------------------------------------------------------------------------------------------
-- alter policy hospital_auth_tokens on public.abdm_auth_tokens to public using (hospital_id = ((auth.jwt() ->> 'hospital_id'))::uuid);
-- alter policy hospital_subscriptions on public.abdm_subscriptions to public using (hospital_id = ((auth.jwt() ->> 'hospital_id'))::uuid);
-- alter policy vendors_hospital_scope on public.vendors to public using (hospital_id = ((auth.jwt() ->> 'hospital_id'))::uuid);
-- create policy "Recipients see own notifications" on public.notifications for select to public using (recipient_id = auth.uid());
-- create policy "Recipients update own notifications" on public.notifications for update to public using (recipient_id = auth.uid());
-- drop policy test_catalogue_insert on public.test_catalogue; drop policy test_catalogue_update on public.test_catalogue;
-- drop policy test_catalogue_delete on public.test_catalogue;
-- create policy test_catalogue_access on public.test_catalogue for all to authenticated using (hospital_id = get_my_hospital_id());
-- alter policy catalogue_readable on public.test_catalogue to public;
-- alter policy presets_readable on public.investigation_presets to public;
-- drop policy xray_tpl_insert on public.xray_measurement_templates; drop policy xray_tpl_update on public.xray_measurement_templates;
-- drop policy xray_tpl_delete on public.xray_measurement_templates;
-- create policy xray_tpl_write on public.xray_measurement_templates for all to authenticated
--   using (hospital_id = get_my_hospital_id() and doctor_id in (select id from practitioners where user_id = auth.uid()));

-----------------------------------------------------------------------------------------------
-- G. storage policies (originals)
-----------------------------------------------------------------------------------------------
-- create policy authenticated_read_investigation_reports on storage.objects for select to authenticated using (bucket_id = 'investigation-reports');
-- create policy authenticated_upload_investigation_reports on storage.objects for insert to authenticated with check (bucket_id = 'investigation-reports');
-- create policy wound_photos_read on storage.objects for select to public using (bucket_id = 'wound-photos' and auth.role() = 'authenticated');
-- create policy wound_photos_upload on storage.objects for insert to public with check (bucket_id = 'wound-photos' and auth.role() = 'authenticated');

-----------------------------------------------------------------------------------------------
-- H. audit trail (20260917173916 / 20260917174035)
-----------------------------------------------------------------------------------------------
-- do $$ declare t record; begin
--   for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--            join pg_trigger tg on tg.tgrelid = c.oid and tg.tgname = 'zz_audit_row'
--            where n.nspname='public' loop
--     execute format('drop trigger if exists zz_audit_row on public.%I', t.relname);
--   end loop; end $$;
-- select cron.unschedule('audit-logs-retention');
-- do $$ declare f record; def text; begin
--   for f in select oid from pg_proc where prosrc like '%log_phi_read%' and proname <> 'log_phi_read' loop
--     def := pg_get_functiondef(f.oid);
--     def := regexp_replace(def, E'\\n  perform public\\.log_phi_read\\([^;]*\\);', '', 'g');
--     def := regexp_replace(def, E'\\nselect public\\.log_phi_read\\([^;]*\\);', '', 'g');
--     execute def;
--   end loop; end $$;
-- create policy audit_insert on public.audit_logs for insert to authenticated with check (hospital_id = auth_org());
-- alter policy audit_select on public.audit_logs to authenticated using (hospital_id = auth_org());

-----------------------------------------------------------------------------------------------
-- I. cleanup migration (20260917174316) - templates, dropped column, dropped overloads
-----------------------------------------------------------------------------------------------
-- The dropped overloads and practitioners.security_answer are not restorable from here; recreate
-- them from git history if they turn out to be needed.
-- drop policy rx_templates_select on public.rx_templates; ... and recreate:
-- create policy authenticated_select on public.rx_templates for select to authenticated using (true);
-- create policy authenticated_insert on public.rx_templates for insert to authenticated with check (true);
-- create policy authenticated_update on public.rx_templates for update to authenticated using (true) with check (true);
-- create policy authenticated_delete on public.rx_templates for delete to authenticated using (true);
-- alter policy authenticated_select on public.medication_proposals using (true);
