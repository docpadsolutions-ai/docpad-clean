-- Clinical / staff designation (e.g. Senior Resident) when primary invitation role is Doctor.
alter table public.invitations
  add column if not exists designation text;

comment on column public.invitations.designation is 'Sub-role for Doctor invites (e.g. Consultant); null for non-doctor roles.';
