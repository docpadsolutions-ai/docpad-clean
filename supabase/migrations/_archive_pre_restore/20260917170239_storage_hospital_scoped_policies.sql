-- Storage objects are stored under "<hospital_id>/..." but read policies let ANY signed-in user
-- (any hospital) read lab reports and wound photos. Scope them to the caller's hospital folder.

-- investigation-reports (lab reports / OCR uploads)
drop policy if exists authenticated_read_investigation_reports on storage.objects;
drop policy if exists authenticated_upload_investigation_reports on storage.objects;
create policy investigation_reports_select on storage.objects for select to authenticated
  using (bucket_id = 'investigation-reports'
         and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);
create policy investigation_reports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'investigation-reports'
              and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);

-- wound-photos (four overlapping policies, two of them open to every signed-in user)
drop policy if exists wound_photos_insert on storage.objects;
drop policy if exists wound_photos_read on storage.objects;
drop policy if exists wound_photos_select on storage.objects;
drop policy if exists wound_photos_upload on storage.objects;
create policy wound_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'wound-photos'
         and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);
create policy wound_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'wound-photos'
              and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);

-- patient-photos: uploads/overwrites were allowed for any practitioner of any hospital.
-- (policy bodies replaced again by 20260917170257 with a safe uuid cast)
drop policy if exists patient_photos_insert on storage.objects;
drop policy if exists patient_photos_update on storage.objects;
create policy patient_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-photos'
              and public.patient_hospital_id(nullif(split_part(storage.filename(name), '.', 1), '')::uuid)
                  = (select public.auth_hospital_id()));
create policy patient_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'patient-photos'
         and public.patient_hospital_id(nullif(split_part(storage.filename(name), '.', 1), '')::uuid)
             = (select public.auth_hospital_id()));
alter policy patient_photos_select on storage.objects to authenticated
  using (bucket_id = 'patient-photos'
         and public.patient_hospital_id(nullif(split_part(storage.filename(name), '.', 1), '')::uuid)
             = (select public.auth_hospital_id()));

-- clinical-attachments: the app uploads here (hospital/patient/file) but the bucket was never created.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-attachments', 'clinical-attachments', false, 10485760,
        array['image/jpeg','image/png','image/heic','image/webp','application/pdf']::text[])
on conflict (id) do nothing;
create policy clinical_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'clinical-attachments'
         and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);
create policy clinical_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinical-attachments'
              and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);

-- hospital-assets: hospital logos shown on printed / WhatsApp prescriptions (public read by design).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hospital-assets', 'hospital-assets', true, 2097152,
        array['image/png','image/jpeg','image/jpg','image/svg+xml']::text[])
on conflict (id) do nothing;
create policy hospital_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hospital-assets'
              and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);
create policy hospital_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'hospital-assets'
         and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);
create policy hospital_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'hospital-assets'
         and (storage.foldername(name))[1] = (select public.auth_hospital_id())::text);
