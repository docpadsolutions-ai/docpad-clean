-- Charge item master: billable services/items per hospital (SNOMED or other code systems).
-- hospital_id references public.organizations — DocPad uses organizations for hospital scope.

create table if not exists public.charge_item_definitions (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  code_system text not null default 'http://snomed.info/sct',
  display_name text not null,
  category text not null
    check (
      category in (
        'consultation',
        'procedure',
        'lab_test',
        'imaging',
        'medication',
        'supply',
        'room_charge',
        'nursing',
        'registration',
        'other'
      )
    ),
  base_price numeric(14, 2) not null,
  currency text not null default 'INR',
  tax_type text default 'gst_exempt'
    check (tax_type is null or tax_type in ('gst_exempt', 'gst_5', 'gst_12', 'gst_18')),
  tax_rate numeric(5, 2) not null default 0,
  applicability_rules jsonb not null default '{}',
  eligible_for_packages boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'retired', 'draft')),
  effective_from date not null default (current_date),
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, code, code_system)
);

create index if not exists charge_item_definitions_hospital_category_idx
  on public.charge_item_definitions (hospital_id, category);

create index if not exists charge_item_definitions_hospital_status_idx
  on public.charge_item_definitions (hospital_id, status);

comment on table public.charge_item_definitions is
  'Hospital-scoped price list / charge master for billing (FHIR ChargeItemDefinition–style).';

grant select, insert, update, delete on public.charge_item_definitions to authenticated, service_role;
