-- Reverts 20261018060000_allow_lab_technician_role.sql. Fails on purpose if any
-- practitioner, invitation or permission row already uses 'lab_technician': move or
-- delete those rows first, because the old constraints cannot hold them.

delete from public.role_permissions where role = 'lab_technician';

alter table public.practitioners drop constraint practitioners_role_check;
alter table public.practitioners add constraint practitioners_role_check
  check (role = any (array['doctor', 'pharmacist', 'nurse', 'admin', 'receptionist']));

alter table public.practitioners drop constraint practitioners_user_role_check;
alter table public.practitioners add constraint practitioners_user_role_check
  check (user_role = any (array['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist']));

alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (lower(role) = any (array['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist']));

alter table public.role_permissions drop constraint role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role = any (array['admin', 'doctor', 'nurse', 'pharmacist', 'receptionist']));
