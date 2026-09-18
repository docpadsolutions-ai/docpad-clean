-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260405100000.

-- Clinical / staff designation (e.g. Senior Resident) when primary invitation role is Doctor.
alter table public.invitations
  add column if not exists designation text;
comment on column public.invitations.designation is 'Sub-role for Doctor invites (e.g. Consultant); null for non-doctor roles.';
