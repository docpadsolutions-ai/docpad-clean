-- OPD investigation billing: link charge_items to originating service_request (investigation id) + allow price updates.

alter table public.charge_items
  add column if not exists source_type text;

alter table public.charge_items
  add column if not exists source_id uuid;

create index if not exists charge_items_hospital_source_idx
  on public.charge_items (hospital_id, source_type, source_id)
  where source_id is not null;

comment on column public.charge_items.source_type is
  'Origin of the charge row (e.g. service_request for OPD investigations).';

comment on column public.charge_items.source_id is
  'FK to originating row when applicable (e.g. investigations.id when source_type = service_request).';

drop policy if exists "charge_items_update_practitioner_hospital" on public.charge_items;

create policy "charge_items_update_practitioner_hospital"
on public.charge_items
for update
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_items.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_items.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);
