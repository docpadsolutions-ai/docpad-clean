-- Doctor-facing stats: investigation-level severity vs line-level abnormal flags; result review acknowledgement.

alter table public.investigations
  add column if not exists result_severity text;

alter table public.investigations
  add column if not exists acknowledged_at timestamptz;

comment on column public.investigations.result_severity is
  'Aggregate severity for the investigation result (e.g. critical). Distinct from per-line lab_result_entries.is_abnormal.';

comment on column public.investigations.acknowledged_at is
  'When the clinician acknowledged review of the resulted investigation (OPD doctor sign-off).';

-- Align with existing reviewed_at where present (same acknowledgement moment).
update public.investigations
set acknowledged_at = reviewed_at
where acknowledged_at is null
  and reviewed_at is not null;
