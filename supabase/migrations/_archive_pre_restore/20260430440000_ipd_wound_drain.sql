-- IPD wound assessments, wound photos, drain records + private storage bucket `wound-photos`.

-- ---------------------------------------------------------------------------
-- ipd_wound_assessments
-- ---------------------------------------------------------------------------
create table if not exists public.ipd_wound_assessments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  wound_location text not null,
  wound_type text not null,
  discharge_type text not null,
  suture_status text not null,
  swelling text not null,
  erythema text not null,
  wound_dehiscence boolean not null default false,
  drain_present boolean not null default false,
  wound_notes text,
  assessed_at timestamptz not null default timezone('utc', now()),
  assessed_by uuid references public.practitioners (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ipd_wound_assessments_wound_type_chk check (
    wound_type in ('surgical', 'traumatic', 'pressure', 'other')
  ),
  constraint ipd_wound_assessments_discharge_chk check (
    discharge_type in ('none', 'serous', 'serosanguinous', 'purulent')
  ),
  constraint ipd_wound_assessments_suture_chk check (
    suture_status in ('intact', 'partial_dehiscence', 'full_dehiscence')
  ),
  constraint ipd_wound_assessments_swelling_chk check (
    swelling in ('none', 'mild', 'moderate', 'severe')
  ),
  constraint ipd_wound_assessments_erythema_chk check (
    erythema in ('none', 'mild', 'moderate', 'severe')
  )
);

create index if not exists ipd_wound_assessments_admission_idx
  on public.ipd_wound_assessments (admission_id, assessed_at desc);

create index if not exists ipd_wound_assessments_hospital_idx
  on public.ipd_wound_assessments (hospital_id);

comment on table public.ipd_wound_assessments is
  'Orthopaedic / IPD wound assessment (SBAR-adjacent structured exam).';

-- ---------------------------------------------------------------------------
-- ipd_wound_photos
-- ---------------------------------------------------------------------------
create table if not exists public.ipd_wound_photos (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ipd_wound_assessments (id) on delete cascade,
  storage_path text not null,
  photo_label text,
  taken_at timestamptz not null default timezone('utc', now())
);

create index if not exists ipd_wound_photos_assessment_idx
  on public.ipd_wound_photos (assessment_id);

-- ---------------------------------------------------------------------------
-- ipd_drain_records
-- ---------------------------------------------------------------------------
create table if not exists public.ipd_drain_records (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  wound_assessment_id uuid references public.ipd_wound_assessments (id) on delete set null,
  shift text not null,
  drain_name text not null default 'Surgical Drain',
  drain_type text not null,
  output_ml numeric not null default 0,
  colour text not null,
  consistency text not null,
  odour text not null,
  drain_site_ok boolean not null default true,
  drain_removed boolean not null default false,
  removed_at timestamptz,
  notes text,
  recorded_at timestamptz not null default timezone('utc', now()),
  recorded_by uuid references public.practitioners (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ipd_drain_records_shift_chk check (
    lower(trim(shift)) in ('morning', 'afternoon', 'night')
  ),
  constraint ipd_drain_records_drain_type_chk check (
    drain_type in ('closed_suction', 'open', 'jackson_pratt', 'penrose')
  ),
  constraint ipd_drain_records_colour_chk check (
    colour in ('sanguinous', 'serosanguinous', 'serous', 'purulent', 'bilious')
  ),
  constraint ipd_drain_records_consistency_chk check (
    consistency in ('thin', 'thick', 'clotted')
  ),
  constraint ipd_drain_records_odour_chk check (
    odour in ('none', 'mild', 'offensive')
  )
);

create index if not exists ipd_drain_records_admission_idx
  on public.ipd_drain_records (admission_id, recorded_at desc);

create index if not exists ipd_drain_records_hospital_idx
  on public.ipd_drain_records (hospital_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ipd_wound_assessments enable row level security;
alter table public.ipd_wound_photos enable row level security;
alter table public.ipd_drain_records enable row level security;

drop policy if exists ipd_wound_assessments_staff on public.ipd_wound_assessments;
create policy ipd_wound_assessments_staff
  on public.ipd_wound_assessments
  for all
  to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_wound_assessments.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_wound_assessments.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists ipd_wound_photos_staff on public.ipd_wound_photos;
create policy ipd_wound_photos_staff
  on public.ipd_wound_photos
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.ipd_wound_assessments wa
      inner join public.practitioners pr
        on pr.hospital_id = wa.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      where wa.id = ipd_wound_photos.assessment_id
    )
  )
  with check (
    exists (
      select 1
      from public.ipd_wound_assessments wa
      inner join public.practitioners pr
        on pr.hospital_id = wa.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      where wa.id = ipd_wound_photos.assessment_id
    )
  );

drop policy if exists ipd_drain_records_staff on public.ipd_drain_records;
create policy ipd_drain_records_staff
  on public.ipd_drain_records
  for all
  to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_drain_records.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_drain_records.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.ipd_wound_assessments to authenticated, service_role;
grant select, insert, update, delete on public.ipd_wound_photos to authenticated, service_role;
grant select, insert, update, delete on public.ipd_drain_records to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: wound-photos — path: {hospital_id}/{patient_id}/{assessment_id}/{filename}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wound-photos',
  'wound-photos',
  false,
  15728640,
  array[
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, storage.buckets.allowed_mime_types);

drop policy if exists wound_photos_storage_select on storage.objects;
create policy wound_photos_storage_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'wound-photos'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

drop policy if exists wound_photos_storage_insert on storage.objects;
create policy wound_photos_storage_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'wound-photos'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

drop policy if exists wound_photos_storage_update on storage.objects;
create policy wound_photos_storage_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'wound-photos'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  )
  with check (
    bucket_id = 'wound-photos'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

drop policy if exists wound_photos_storage_delete on storage.objects;
create policy wound_photos_storage_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'wound-photos'
    and public.auth_org() is not null
    and (storage.foldername(name))[1] = public.auth_org()::text
  );
