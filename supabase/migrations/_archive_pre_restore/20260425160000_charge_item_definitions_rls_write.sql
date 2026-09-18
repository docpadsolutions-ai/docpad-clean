-- Allow hospital-scoped practitioners to maintain charge_item_definitions (admin Pricing UI).

drop policy if exists "charge_item_definitions_insert_practitioner_hospital" on public.charge_item_definitions;
create policy "charge_item_definitions_insert_practitioner_hospital"
on public.charge_item_definitions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_item_definitions.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

drop policy if exists "charge_item_definitions_update_practitioner_hospital" on public.charge_item_definitions;
create policy "charge_item_definitions_update_practitioner_hospital"
on public.charge_item_definitions
for update
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_item_definitions.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_item_definitions.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

comment on policy "charge_item_definitions_insert_practitioner_hospital" on public.charge_item_definitions is
  'Hospital staff can insert charge master rows for their organization.';

comment on policy "charge_item_definitions_update_practitioner_hospital" on public.charge_item_definitions is
  'Hospital staff can update charge master rows for their organization.';
