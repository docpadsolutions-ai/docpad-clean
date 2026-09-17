-- IPD investigation orders: SLA / clinician acknowledgement (pending-results panel parity).

alter table public.ipd_investigation_orders
  add column if not exists expected_at timestamptz;

alter table public.ipd_investigation_orders
  add column if not exists acknowledged_at timestamptz;

alter table public.ipd_investigation_orders
  add column if not exists acknowledged_by uuid references public.practitioners (id) on delete set null;

alter table public.ipd_investigation_orders
  add column if not exists sla_acknowledged_at timestamptz;

comment on column public.ipd_investigation_orders.expected_at is
  'Expected result ready time for SLA (late/lost). Backfilled from created_at + expected_tat_hrs when possible.';
comment on column public.ipd_investigation_orders.acknowledged_at is
  'When clinician acknowledged a resulted IPD lab order (pending-results review bucket).';
comment on column public.ipd_investigation_orders.acknowledged_by is
  'Practitioner who acknowledged the resulted order.';
comment on column public.ipd_investigation_orders.sla_acknowledged_at is
  'When clinician acknowledged a pending/late pipeline row from the IPD pending-results panel.';

-- Backfill expected_at from created_at + TAT when missing.
update public.ipd_investigation_orders io
set expected_at = io.created_at + interval '1 hour' * coalesce(io.expected_tat_hrs::numeric, 0)
where io.expected_at is null
  and io.created_at is not null
  and coalesce(io.expected_tat_hrs::numeric, 0) > 0;
