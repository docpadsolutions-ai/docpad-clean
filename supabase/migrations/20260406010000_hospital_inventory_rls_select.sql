-- Allow authenticated practitioners to SELECT formulary rows for their hospital.
-- Without this (or with RLS enabled and no policy), PostgREST returns zero rows even when data exists.

alter table public.hospital_inventory enable row level security;

drop policy if exists "hospital_inventory_select_practitioner_hospital" on public.hospital_inventory;

create policy "hospital_inventory_select_practitioner_hospital"
on public.hospital_inventory
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = hospital_inventory.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

comment on policy "hospital_inventory_select_practitioner_hospital" on public.hospital_inventory is
  'Pharmacists/staff: read inventory where practitioners row matches session (user_id or id = auth.uid()) and same hospital_id.';
