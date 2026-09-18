-- OPD lab payments: record paid investigation charges (see reception PendingLabPayments).

alter table public.investigation_bills
  add column if not exists encounter_id uuid,
  add column if not exists net_amount numeric(12, 2),
  add column if not exists payment_status text,
  add column if not exists paid_amount numeric(12, 2),
  add column if not exists paid_at timestamptz;

comment on column public.investigation_bills.encounter_id is
  'OPD encounter when the bill originates from an encounter-scoped charge item.';

comment on column public.investigation_bills.net_amount is
  'Net amount for this investigation payment row (OPD charge_items.net_amount snapshot).';

comment on column public.investigation_bills.payment_status is
  'e.g. paid when reception marks the OPD lab charge paid.';
