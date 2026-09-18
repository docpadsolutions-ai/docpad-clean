-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260905163236.

-- Remove policies that conflict with fk_treating_doctor (doctor_id is a
-- practitioners.id, never an auth.uid(), so these can only reject valid rows)
drop policy if exists "Doctors can insert own encounters" on public.opd_encounters;
drop policy if exists "Doctors can view own encounters"   on public.opd_encounters;
drop policy if exists "Doctors can update own encounters" on public.opd_encounters;

-- Re-create the role-based policies WITH tenant scoping
drop policy if exists "View encounters by role"   on public.opd_encounters;
drop policy if exists "Create encounters by role" on public.opd_encounters;
drop policy if exists "Update encounters by role" on public.opd_encounters;

create policy "View encounters by role" on public.opd_encounters
  for select
  using (
    hospital_id = public.get_my_hospital_id()
    and public.has_permission(auth.uid(), 'encounters', 'read')
  );

create policy "Create encounters by role" on public.opd_encounters
  for insert
  with check (
    hospital_id = public.get_my_hospital_id()
    and public.has_permission(auth.uid(), 'encounters', 'create')
  );

create policy "Update encounters by role" on public.opd_encounters
  for update
  using (
    hospital_id = public.get_my_hospital_id()
    and public.has_permission(auth.uid(), 'encounters', 'update')
  );

NOTIFY pgrst, 'reload schema';
