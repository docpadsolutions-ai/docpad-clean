-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917165958.

-- Staff could read/update patients, prescriptions, vitals and inventory of OTHER hospitals:
-- those policies only checked the role permission, never the hospital.

-- RLS-free lookups used inside policies (avoid nested RLS on opd_encounters/patients).
create or replace function public.encounter_hospital_id(p_encounter_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select hospital_id from opd_encounters where id = p_encounter_id $$;

create or replace function public.patient_hospital_id(p_patient_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select hospital_id from patients where id = p_patient_id $$;

revoke all on function public.encounter_hospital_id(uuid) from public, anon;
revoke all on function public.patient_hospital_id(uuid) from public, anon;
grant execute on function public.encounter_hospital_id(uuid) to authenticated, service_role;
grant execute on function public.patient_hospital_id(uuid) to authenticated, service_role;

-- has_permission only reads; STABLE lets Postgres evaluate it once per statement when wrapped.
alter function public.has_permission(uuid, text, text) stable;

-- patients
alter policy "View patients by role" on public.patients to authenticated
  using (hospital_id = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'patients', 'read')));
alter policy "Create patients by role" on public.patients to authenticated
  with check (hospital_id = (select auth_hospital_id())
              and (select has_permission((select auth.uid()), 'patients', 'create')));
alter policy "Update patients by role" on public.patients to authenticated
  using (hospital_id = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'patients', 'update')))
  with check (hospital_id = (select auth_hospital_id()));

-- prescriptions (scoped through the encounter)
alter policy "View prescriptions by role" on public.prescriptions to authenticated
  using (encounter_hospital_id(encounter_id) = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'prescriptions', 'read')));
alter policy "Create prescriptions by role" on public.prescriptions to authenticated
  with check (encounter_hospital_id(encounter_id) = (select auth_hospital_id())
              and (select has_permission((select auth.uid()), 'prescriptions', 'create')));
alter policy "Update prescriptions by role" on public.prescriptions to authenticated
  using (encounter_hospital_id(encounter_id) = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'prescriptions', 'update')))
  with check (encounter_hospital_id(encounter_id) = (select auth_hospital_id()));

-- vitals
alter policy "View vitals by role" on public.vitals to authenticated
  using (coalesce(encounter_hospital_id(encounter_id), patient_hospital_id(patient_id)) = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'vitals', 'read')));
alter policy "Create vitals by role" on public.vitals to authenticated
  with check (coalesce(encounter_hospital_id(encounter_id), patient_hospital_id(patient_id)) = (select auth_hospital_id())
              and (select has_permission((select auth.uid()), 'vitals', 'create')));
alter policy "Update vitals by role" on public.vitals to authenticated
  using (coalesce(encounter_hospital_id(encounter_id), patient_hospital_id(patient_id)) = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'vitals', 'update')))
  with check (coalesce(encounter_hospital_id(encounter_id), patient_hospital_id(patient_id)) = (select auth_hospital_id()));

-- hospital_inventory: hi_select already gives same-hospital read, so the unscoped view policy is dropped.
drop policy "View inventory by role" on public.hospital_inventory;
alter policy "Create inventory by role" on public.hospital_inventory to authenticated
  with check (hospital_id = (select auth_hospital_id())
              and (select has_permission((select auth.uid()), 'hospital_inventory', 'create')));
alter policy "Update inventory by role" on public.hospital_inventory to authenticated
  using (hospital_id = (select auth_hospital_id())
         and (select has_permission((select auth.uid()), 'hospital_inventory', 'update')))
  with check (hospital_id = (select auth_hospital_id()));
alter policy hi_select on public.hospital_inventory
  using (hospital_id = (select get_my_hospital_id()));

-- accounts: one policy, correct practitioner lookup (id OR user_id), authenticated only.
drop policy "Users can view accounts in their hospital" on public.accounts;
alter policy "Users can manage accounts in their hospital" on public.accounts to authenticated
  using (hospital_id = (select auth_hospital_id()))
  with check (hospital_id = (select auth_hospital_id()));

-- clinical_procedure_consents: read was open to every signed-in user of every hospital.
alter policy authenticated_select on public.clinical_procedure_consents
  using (encounter_hospital_id(opd_encounter_id) = (select auth_hospital_id()));
