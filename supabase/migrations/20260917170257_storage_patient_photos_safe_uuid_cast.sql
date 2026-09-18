-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917170257.

-- Guard the filename -> uuid cast so a non-uuid object name can never raise inside a policy.
create or replace function public.patient_hospital_id_from_object(p_name text)
returns uuid language sql stable security definer set search_path = public
as $$
  select case
    when split_part(storage.filename(p_name), '.', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (select hospital_id from patients where id = split_part(storage.filename(p_name), '.', 1)::uuid)
  end
$$;
revoke all on function public.patient_hospital_id_from_object(text) from public, anon;
grant execute on function public.patient_hospital_id_from_object(text) to authenticated, service_role;

alter policy patient_photos_insert on storage.objects
  with check (bucket_id = 'patient-photos'
              and public.patient_hospital_id_from_object(name) = (select public.auth_hospital_id()));
alter policy patient_photos_update on storage.objects
  using (bucket_id = 'patient-photos'
         and public.patient_hospital_id_from_object(name) = (select public.auth_hospital_id()));
alter policy patient_photos_select on storage.objects
  using (bucket_id = 'patient-photos'
         and public.patient_hospital_id_from_object(name) = (select public.auth_hospital_id()));
