-- 1. Prescription templates had no owner or hospital: any signed-in user could edit or delete
--    every hospital's templates. Existing rows are assigned to Rameshwar Dass Memorial Hospital.
alter table public.rx_templates
  add column if not exists hospital_id uuid references public.hospitals(id),
  add column if not exists created_by uuid;

update public.rx_templates
set hospital_id = 'e90e4607-dd60-4821-b736-02a2577432e0'
where hospital_id is null;

alter table public.rx_templates alter column hospital_id set not null;
create index if not exists idx_rx_templates_hospital_id on public.rx_templates (hospital_id);
create index if not exists idx_rx_template_items_template_id on public.rx_template_items (template_id);

drop policy if exists authenticated_select on public.rx_templates;
drop policy if exists authenticated_insert on public.rx_templates;
drop policy if exists authenticated_update on public.rx_templates;
drop policy if exists authenticated_delete on public.rx_templates;
create policy rx_templates_select on public.rx_templates for select to authenticated
  using (hospital_id = (select auth_hospital_id()));
create policy rx_templates_insert on public.rx_templates for insert to authenticated
  with check (hospital_id = (select auth_hospital_id()));
create policy rx_templates_update on public.rx_templates for update to authenticated
  using (hospital_id = (select auth_hospital_id())) with check (hospital_id = (select auth_hospital_id()));
create policy rx_templates_delete on public.rx_templates for delete to authenticated
  using (hospital_id = (select auth_hospital_id()));

drop policy if exists authenticated_select on public.rx_template_items;
drop policy if exists authenticated_insert on public.rx_template_items;
drop policy if exists authenticated_update on public.rx_template_items;
drop policy if exists authenticated_delete on public.rx_template_items;
create policy rx_template_items_select on public.rx_template_items for select to authenticated
  using (exists (select 1 from rx_templates t where t.id = template_id and t.hospital_id = (select auth_hospital_id())));
create policy rx_template_items_insert on public.rx_template_items for insert to authenticated
  with check (exists (select 1 from rx_templates t where t.id = template_id and t.hospital_id = (select auth_hospital_id())));
create policy rx_template_items_update on public.rx_template_items for update to authenticated
  using (exists (select 1 from rx_templates t where t.id = template_id and t.hospital_id = (select auth_hospital_id())))
  with check (exists (select 1 from rx_templates t where t.id = template_id and t.hospital_id = (select auth_hospital_id())));
create policy rx_template_items_delete on public.rx_template_items for delete to authenticated
  using (exists (select 1 from rx_templates t where t.id = template_id and t.hospital_id = (select auth_hospital_id())));

-- 2. medication_proposals were readable across hospitals (hospital_id is text on this table).
alter policy authenticated_select on public.medication_proposals to authenticated
  using (_uuid_or_null(hospital_id) = (select auth_hospital_id()));

-- 3. Unused plaintext column, readable by every colleague.
alter table public.practitioners drop column if exists security_answer;

-- 4. One patient row had no hospital, so it was invisible to the app (owner asked for it to go).
delete from public.patients where id = '8f430b6d-7753-4741-a578-0655b906bb01' and hospital_id is null;

-- 5. get_my_hospital_id() only matched practitioners.user_id, auth_hospital_id() matched id OR user_id,
--    and policies used both. Make them behave the same.
create or replace function public.get_my_hospital_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select hospital_id from practitioners
  where user_id = auth.uid() or id = auth.uid()
  limit 1;
$$;

-- 6. Dead function overloads (superseded signatures the app never calls).
drop function if exists public.admit_patient(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text);
drop function if exists public.complete_nursing_task(uuid, text, jsonb);
drop function if exists public.get_claims_summary(uuid, date, date);
drop function if exists public.get_insurance_billing_kpis();
drop function if exists public.get_latest_handover(uuid);
drop function if exists public.get_nursing_shift_tasks(text, date);
drop function if exists public.get_or_create_progress_note(uuid, uuid, uuid);
drop function if exists public.get_pending_preauths();
drop function if exists public.mark_mar_dose(uuid, text, text, text, text, text, text);
drop function if exists public.record_payment(uuid, numeric, text, text, text);
drop function if exists public.send_role_invitation(text, text, uuid, uuid);
drop function if exists public.submit_insurance_claim(uuid);
drop function if exists public.upsert_discharge_summary(uuid, text, date, text, text, text[], text[], text, text[], jsonb, text, date, text, text, text, jsonb, text, text);
drop function if exists public.upsert_preauth_request(uuid, uuid, uuid, uuid, numeric, jsonb, text, jsonb, jsonb);
