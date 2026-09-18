-- IPD consent type catalog: system defaults (hospital_id null) + per-hospital overrides.

create table if not exists public.ipd_consent_types (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.organizations (id) on delete cascade,
  code text not null,
  display_name text not null,
  category text not null default 'other',
  is_mandatory boolean not null default false,
  template_language text not null default 'en',
  template_body text,
  file_path text,
  file_name text,
  version text not null default '1.0',
  sort_order int not null default 0,
  is_active boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ipd_consent_types_category_chk check (
    category in (
      'admission',
      'anaesthesia',
      'surgical',
      'blood_transfusion',
      'procedure',
      'financial',
      'dpdpa',
      'media',
      'research',
      'dnr',
      'other'
    )
  ),
  constraint ipd_consent_types_template_language_chk check (
    template_language in ('en', 'hi', 'both')
  )
);

-- System-wide codes unique when hospital_id is null; per-hospital codes unique when set.
create unique index if not exists ipd_consent_types_system_code_uidx
  on public.ipd_consent_types (lower(code))
  where hospital_id is null;

create unique index if not exists ipd_consent_types_hospital_code_uidx
  on public.ipd_consent_types (hospital_id, lower(code))
  where hospital_id is not null;

create index if not exists ipd_consent_types_hospital_sort_idx
  on public.ipd_consent_types (hospital_id, sort_order);

comment on table public.ipd_consent_types is
  'Catalog of consent forms: system rows (hospital_id null) + hospital-specific templates.';

alter table public.ipd_consent_types enable row level security;

drop policy if exists "ipd_consent_types_select_staff" on public.ipd_consent_types;
create policy "ipd_consent_types_select_staff"
on public.ipd_consent_types
for select
to authenticated
using (
  hospital_id is null
  or exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = ipd_consent_types.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

drop policy if exists "ipd_consent_types_insert_admin" on public.ipd_consent_types;
create policy "ipd_consent_types_insert_admin"
on public.ipd_consent_types
for insert
to authenticated
with check (
  hospital_id is not null
  and public._caller_is_hospital_staff_admin(hospital_id)
);

drop policy if exists "ipd_consent_types_update_admin" on public.ipd_consent_types;
create policy "ipd_consent_types_update_admin"
on public.ipd_consent_types
for update
to authenticated
using (
  hospital_id is not null
  and public._caller_is_hospital_staff_admin(hospital_id)
)
with check (
  hospital_id is not null
  and public._caller_is_hospital_staff_admin(hospital_id)
);

drop policy if exists "ipd_consent_types_delete_admin" on public.ipd_consent_types;
create policy "ipd_consent_types_delete_admin"
on public.ipd_consent_types
for delete
to authenticated
using (
  hospital_id is not null
  and public._caller_is_hospital_staff_admin(hospital_id)
);

grant select, insert, update, delete on public.ipd_consent_types to authenticated, service_role;

-- Optional link from admission consent rows to catalog (when table exists).
do $blk$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'ipd_admission_consents'
  ) then
    execute 'alter table public.ipd_admission_consents add column if not exists consent_type_id uuid references public.ipd_consent_types (id) on delete set null';
  end if;
end;
$blk$;

-- Seed system defaults (hospital_id null) — idempotent.
insert into public.ipd_consent_types (
  hospital_id, code, display_name, category, is_mandatory, template_language, template_body, version, sort_order, is_active
)
select v.*
from (
  values
    (null::uuid, 'SURGICAL_CONSENT', 'Surgical consent', 'surgical'::text, true, 'en'::text, null::text, '1.0'::text, 10, true),
    (null, 'ANAESTHESIA_CONSENT', 'Anaesthesia consent', 'anaesthesia', true, 'en', null, '1.0', 20, true),
    (null, 'BLOOD_TRANSFUSION', 'Blood transfusion', 'blood_transfusion', false, 'en', null, '1.0', 30, true),
    (null, 'PROCEDURE_CONSENT', 'Procedure consent', 'procedure', false, 'en', null, '1.0', 40, true),
    (null, 'MEDIA_CONSENT', 'Photography / media', 'media', false, 'en', null, '1.0', 50, true),
    (null, 'RESEARCH_CONSENT', 'Research consent', 'research', false, 'en', null, '1.0', 60, true),
    (null, 'DNR', 'Do not resuscitate (DNR)', 'dnr', false, 'en', null, '1.0', 70, true)
) as v(hospital_id, code, display_name, category, is_mandatory, template_language, template_body, version, sort_order, is_active)
where not exists (
  select 1 from public.ipd_consent_types t
  where t.hospital_id is null and lower(t.code) = lower(v.code)
);

-- ---------------------------------------------------------------------------
-- Storage: consent-templates (PDFs; public read for getPublicUrl links)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consent-templates',
  'consent-templates',
  true,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit),
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "consent_templates_public_read" on storage.objects;
create policy "consent_templates_public_read"
on storage.objects
for select
to public
using (bucket_id = 'consent-templates');

drop policy if exists "consent_templates_authenticated_insert" on storage.objects;
create policy "consent_templates_authenticated_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'consent-templates'
  and public.auth_org() is not null
  and (storage.foldername(name))[1] = public.auth_org()::text
);

drop policy if exists "consent_templates_authenticated_update" on storage.objects;
create policy "consent_templates_authenticated_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'consent-templates'
  and public.auth_org() is not null
  and (storage.foldername(name))[1] = public.auth_org()::text
)
with check (
  bucket_id = 'consent-templates'
  and public.auth_org() is not null
  and (storage.foldername(name))[1] = public.auth_org()::text
);

drop policy if exists "consent_templates_authenticated_delete" on storage.objects;
create policy "consent_templates_authenticated_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'consent-templates'
  and public.auth_org() is not null
  and (storage.foldername(name))[1] = public.auth_org()::text
);
