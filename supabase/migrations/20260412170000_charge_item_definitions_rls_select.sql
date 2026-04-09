-- charge_item_definitions: allow practitioners to read the price list for their hospital.
-- If RLS was enabled without a policy (common in Supabase), PostgREST returns 200 + [] with no error.

alter table public.charge_item_definitions enable row level security;

drop policy if exists "charge_item_definitions_select_practitioner_hospital" on public.charge_item_definitions;

create policy "charge_item_definitions_select_practitioner_hospital"
on public.charge_item_definitions
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_item_definitions.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

comment on policy "charge_item_definitions_select_practitioner_hospital" on public.charge_item_definitions is
  'Billing UI: read charge master rows for the same hospital_id as the signed-in practitioner.';
