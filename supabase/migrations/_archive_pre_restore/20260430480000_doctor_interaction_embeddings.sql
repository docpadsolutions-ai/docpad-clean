-- Clinical interaction embeddings (Gemini text-embedding-004 → pgvector).

create extension if not exists vector with schema extensions;

create table if not exists public.doctor_interaction_embeddings (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  interaction_type text not null,
  source_table text not null,
  source_id uuid not null,
  content_text text not null,
  embedding vector(768) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint doctor_interaction_embeddings_interaction_type_chk check (
    interaction_type in (
      'prescription',
      'investigation',
      'diagnosis',
      'followup',
      'admission_order',
      'nurse_instruction',
      'procedure',
      'referral'
    )
  ),
  constraint doctor_interaction_embeddings_source_uq unique (source_table, source_id)
);

create index if not exists doctor_interaction_embeddings_hospital_idx
  on public.doctor_interaction_embeddings (hospital_id, created_at desc);

create index if not exists doctor_interaction_embeddings_practitioner_idx
  on public.doctor_interaction_embeddings (practitioner_id, created_at desc);

comment on table public.doctor_interaction_embeddings is
  '768-dim Gemini embeddings of clinical interaction text for analytics / similarity.';

alter table public.doctor_interaction_embeddings enable row level security;

-- No direct client access; edge function uses service_role.
drop policy if exists doctor_interaction_embeddings_deny_authenticated on public.doctor_interaction_embeddings;
create policy doctor_interaction_embeddings_deny_authenticated
  on public.doctor_interaction_embeddings
  for all
  to authenticated
  using (false)
  with check (false);

grant select, insert, update, delete on public.doctor_interaction_embeddings to service_role;
