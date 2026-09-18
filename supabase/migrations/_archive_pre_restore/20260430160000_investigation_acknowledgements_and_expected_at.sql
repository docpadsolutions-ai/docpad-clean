-- SLA panel: expected due time, pipeline dismiss, and acknowledgement audit rows.

alter table public.investigations
  add column if not exists expected_at timestamptz;

alter table public.investigations
  add column if not exists sla_acknowledged_at timestamptz;

comment on column public.investigations.expected_at is
  'Expected result ready time for SLA (late/lost). Backfilled from ordered_at + expected_tat_hours when possible.';
comment on column public.investigations.sla_acknowledged_at is
  'When clinician acknowledged a pending/late pipeline row from the pending-results panel.';

-- Backfill expected_at from ordered_at + TAT when missing.
update public.investigations inv
set expected_at = inv.ordered_at + interval '1 hour' * coalesce(inv.expected_tat_hours::numeric, 0)
where inv.expected_at is null
  and inv.ordered_at is not null
  and coalesce(inv.expected_tat_hours::numeric, 0) > 0;

create table if not exists public.investigation_acknowledgements (
  id uuid primary key default gen_random_uuid (),
  investigation_id uuid not null references public.investigations (id) on delete cascade,
  practitioner_id uuid references public.practitioners (id) on delete set null,
  reason text not null default 'result_review'
    check (reason in ('result_review', 'sla_pipeline')),
  created_at timestamptz not null default now ()
);

create index if not exists investigation_acknowledgements_investigation_id_idx
  on public.investigation_acknowledgements (investigation_id);

alter table public.investigation_acknowledgements enable row level security;

drop policy if exists investigation_acknowledgements_all_authenticated on public.investigation_acknowledgements;

create policy investigation_acknowledgements_all_authenticated
  on public.investigation_acknowledgements
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.investigation_acknowledgements to authenticated, service_role;
