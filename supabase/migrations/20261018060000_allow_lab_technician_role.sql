-- The app has a lab technician role end to end (lib/userRole.ts, lib/navConfig.ts,
-- the "Lab Tech" option on the admin invite screen, which writes 'lab_technician'),
-- but four check constraints in the live database allow only admin, doctor, nurse,
-- pharmacist and receptionist. A Lab Tech invite therefore failed at its first insert
-- into invitations, and no lab practitioner could exist (BREAKAGE-TRIAGE N-09).
--
-- Each constraint is re-created with 'lab_technician' added and nothing removed, so
-- every existing row still satisfies it.
--
-- role_permissions gets read access to patients and encounters for the new role:
-- what a lab needs to identify the patient and the ordering encounter. It is read by
-- application code only; no RLS policy in this repo consults it.
--
-- Rollback: supabase/rollbacks/20261018060000_allow_lab_technician_role_rollback.sql

alter table public.practitioners drop constraint practitioners_role_check;
alter table public.practitioners add constraint practitioners_role_check
  check (role = any (array['doctor', 'pharmacist', 'nurse', 'admin', 'receptionist', 'lab_technician']));

alter table public.practitioners drop constraint practitioners_user_role_check;
alter table public.practitioners add constraint practitioners_user_role_check
  check (user_role = any (array['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist', 'lab_technician']));

alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (lower(role) = any (array['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist', 'lab_technician']));

alter table public.role_permissions drop constraint role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role = any (array['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist', 'lab_technician']));

insert into public.role_permissions (role, resource, action)
select 'lab_technician', v.resource, v.action
from (values ('patients', 'read'), ('encounters', 'read')) as v(resource, action)
where not exists (
  select 1 from public.role_permissions rp
  where rp.role = 'lab_technician' and rp.resource = v.resource and rp.action = v.action
);
