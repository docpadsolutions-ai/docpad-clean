-- Invoices, charge item instances, patient billing accounts, and line items.
-- Safe on empty DBs; if `invoices` already exists remotely, apply column/trigger deltas manually or skip conflicting statements.

-- ---------------------------------------------------------------------------
-- charge_items: billable row instance (links definition + price snapshot for invoice lines)
-- ---------------------------------------------------------------------------
create table if not exists public.charge_items (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  definition_id uuid not null references public.charge_item_definitions (id) on delete restrict,
  display_label text,
  unit_price_snapshot numeric(14, 2) not null default 0,
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);

create index if not exists charge_items_hospital_definition_idx
  on public.charge_items (hospital_id, definition_id);

-- ---------------------------------------------------------------------------
-- patient_billing_accounts: insurance / corporate; NULL on invoice = self-pay
-- ---------------------------------------------------------------------------
create table if not exists public.patient_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  label text not null,
  account_type text not null default 'insurance'
    check (account_type in ('self_pay', 'insurance', 'corporate')),
  is_default boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists patient_billing_accounts_patient_hospital_idx
  on public.patient_billing_accounts (patient_id, hospital_id);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete restrict,
  encounter_id uuid,
  account_id uuid references public.patient_billing_accounts (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'cancelled', 'voided', 'balanced')),
  invoice_number text,
  invoice_date timestamptz not null default (timezone('utc', now())),
  due_date date,
  notes text,
  total_net numeric(14, 2) not null default 0,
  total_discount numeric(14, 2) not null default 0,
  total_tax numeric(14, 2) not null default 0,
  total_gross numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0,
  balance_due numeric(14, 2) not null default 0,
  fhir_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists invoices_invoice_number_key
  on public.invoices (invoice_number)
  where invoice_number is not null;

create index if not exists invoices_hospital_patient_idx
  on public.invoices (hospital_id, patient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Auto invoice_number: INV-YYYY-NNNNNN per hospital per calendar year (UTC)
-- ---------------------------------------------------------------------------
create or replace function public.trg_set_invoice_number()
returns trigger
language plpgsql
as $fn$
declare
  next_n int;
  y text;
begin
  if new.invoice_number is not null and btrim(new.invoice_number) <> '' then
    return new;
  end if;
  y := to_char(coalesce(new.invoice_date, timezone('utc', now())) at time zone 'utc', 'YYYY');
  select coalesce(max(split_part(i.invoice_number, '-', 3)::int), 0) + 1
  into next_n
  from public.invoices i
  where i.hospital_id = new.hospital_id
    and i.invoice_number ~ '^INV-[0-9]{4}-[0-9]+$'
    and split_part(i.invoice_number, '-', 2) = y
    and i.id is distinct from new.id;

  new.invoice_number := 'INV-' || y || '-' || lpad(next_n::text, 6, '0');
  return new;
end;
$fn$;

drop trigger if exists set_invoice_number_before_insert on public.invoices;
create trigger set_invoice_number_before_insert
  before insert on public.invoices
  for each row
  execute function public.trg_set_invoice_number();

-- ---------------------------------------------------------------------------
-- invoice_line_items
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  charge_item_id uuid not null references public.charge_items (id) on delete restrict,
  line_number integer not null,
  quantity numeric(14, 4) not null default 1,
  unit_price numeric(14, 2) not null,
  discount_percent numeric(9, 4) not null default 0,
  tax_percent numeric(9, 4) not null default 0,
  line_subtotal numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  unique (invoice_id, line_number)
);

create index if not exists invoice_line_items_invoice_idx
  on public.invoice_line_items (invoice_id);

-- ---------------------------------------------------------------------------
-- Grants (tighten with RLS in production)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.charge_items to authenticated, service_role;
grant select, insert, update, delete on public.patient_billing_accounts to authenticated, service_role;
grant select, insert, update, delete on public.invoices to authenticated, service_role;
grant select, insert, update, delete on public.invoice_line_items to authenticated, service_role;
