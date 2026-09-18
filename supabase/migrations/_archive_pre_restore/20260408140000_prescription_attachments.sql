-- Links completed lab OCR uploads to a prescription output (print / WhatsApp).

create table if not exists public.prescription_attachments (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.opd_encounters (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  hospital_id uuid references public.organizations (id) on delete set null,
  investigation_id uuid references public.investigations (id) on delete set null,
  ocr_upload_id uuid not null references public.investigation_ocr_uploads (id) on delete cascade,
  display_name text,
  include_in_whatsapp boolean not null default true,
  include_in_print boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (encounter_id, ocr_upload_id)
);

create index if not exists prescription_attachments_encounter_id_idx
  on public.prescription_attachments (encounter_id);

create index if not exists prescription_attachments_ocr_upload_id_idx
  on public.prescription_attachments (ocr_upload_id);

comment on table public.prescription_attachments is
  'Lab reports attached to prescription output; lab lines come from lab_result_entries via ocr_upload_id.';

alter table public.prescription_attachments enable row level security;

create policy "prescription_attachments_authenticated_all"
  on public.prescription_attachments
  for all
  to authenticated
  using (true)
  with check (true);

create policy "prescription_attachments_anon_select"
  on public.prescription_attachments
  for select
  to anon
  using (true);

grant select, insert, update, delete on public.prescription_attachments to authenticated, service_role;
grant select on public.prescription_attachments to anon;
