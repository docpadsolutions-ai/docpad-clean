-- Clinical image/file attachments (OPD encounters + IPD admissions; private storage).

create table if not exists public.clinical_attachments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  opd_encounter_id uuid references public.opd_encounters (id) on delete set null,
  ipd_admission_id uuid references public.ipd_admissions (id) on delete set null,
  uploaded_by uuid references public.practitioners (id) on delete set null,
  uploaded_at timestamptz not null default timezone('utc', now()),
  storage_path text not null,
  file_name text,
  file_size_bytes bigint,
  mime_type text,
  attachment_type text,
  body_region text,
  clinical_context text,
  fhir_json jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists clinical_attachments_patient_uploaded_idx
  on public.clinical_attachments (patient_id, uploaded_at desc);

create index if not exists clinical_attachments_hospital_idx
  on public.clinical_attachments (hospital_id);

create index if not exists clinical_attachments_opd_encounter_idx
  on public.clinical_attachments (opd_encounter_id)
  where opd_encounter_id is not null;

create index if not exists clinical_attachments_ipd_admission_idx
  on public.clinical_attachments (ipd_admission_id)
  where ipd_admission_id is not null;

comment on table public.clinical_attachments is
  'Clinical media/PDF attachments; storage object path is first-segment scoped by hospital (see storage policies).';

alter table public.clinical_attachments enable row level security;

drop policy if exists clinical_attachments_select_practitioner_hospital on public.clinical_attachments;
create policy clinical_attachments_select_practitioner_hospital
  on public.clinical_attachments for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = clinical_attachments.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists clinical_attachments_insert_practitioner_hospital on public.clinical_attachments;
create policy clinical_attachments_insert_practitioner_hospital
  on public.clinical_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = clinical_attachments.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert on public.clinical_attachments to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-attachments',
  'clinical-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, storage.buckets.allowed_mime_types);

drop policy if exists clinical_attachments_storage_select on storage.objects;
create policy clinical_attachments_storage_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'clinical-attachments'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

drop policy if exists clinical_attachments_storage_insert on storage.objects;
create policy clinical_attachments_storage_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'clinical-attachments'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

drop policy if exists clinical_attachments_storage_update on storage.objects;
create policy clinical_attachments_storage_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'clinical-attachments'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  )
  with check (
    bucket_id = 'clinical-attachments'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

drop policy if exists clinical_attachments_storage_delete on storage.objects;
create policy clinical_attachments_storage_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'clinical-attachments'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );
