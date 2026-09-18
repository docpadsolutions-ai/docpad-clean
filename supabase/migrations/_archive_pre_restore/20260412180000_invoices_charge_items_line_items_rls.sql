-- Row-level security for billing writes/reads scoped to the practitioner's hospital.
-- Without INSERT (+ SELECT for RETURNING) policies, PostgREST inserts can fail or return empty errors in some clients.

alter table public.invoices enable row level security;
alter table public.charge_items enable row level security;
alter table public.invoice_line_items enable row level security;

-- invoices
drop policy if exists "invoices_select_practitioner_hospital" on public.invoices;
drop policy if exists "invoices_insert_practitioner_hospital" on public.invoices;
drop policy if exists "invoices_update_practitioner_hospital" on public.invoices;

create policy "invoices_select_practitioner_hospital"
on public.invoices
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = invoices.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "invoices_insert_practitioner_hospital"
on public.invoices
for insert
to authenticated
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = invoices.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "invoices_update_practitioner_hospital"
on public.invoices
for update
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = invoices.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = invoices.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

-- charge_items
drop policy if exists "charge_items_select_practitioner_hospital" on public.charge_items;
drop policy if exists "charge_items_insert_practitioner_hospital" on public.charge_items;

create policy "charge_items_select_practitioner_hospital"
on public.charge_items
for select
to authenticated
using (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_items.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "charge_items_insert_practitioner_hospital"
on public.charge_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = charge_items.hospital_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

-- invoice_line_items (no hospital_id — scope via parent invoice)
drop policy if exists "invoice_line_items_select_practitioner_hospital" on public.invoice_line_items;
drop policy if exists "invoice_line_items_insert_practitioner_hospital" on public.invoice_line_items;

create policy "invoice_line_items_select_practitioner_hospital"
on public.invoice_line_items
for select
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    inner join public.practitioners pr on pr.hospital_id = i.hospital_id
    where i.id = invoice_line_items.invoice_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);

create policy "invoice_line_items_insert_practitioner_hospital"
on public.invoice_line_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.invoices i
    inner join public.practitioners pr on pr.hospital_id = i.hospital_id
    where i.id = invoice_line_items.invoice_id
      and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
  )
);
