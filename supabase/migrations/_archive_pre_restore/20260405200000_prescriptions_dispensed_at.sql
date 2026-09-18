-- When pharmacy marks a line dispensed (used for daily stats)
alter table public.prescriptions add column if not exists dispensed_at timestamptz;

create index if not exists prescriptions_dispensed_at_idx on public.prescriptions (dispensed_at);

comment on column public.prescriptions.dispensed_at is 'Set when status becomes dispensed; used for pharmacy daily counts.';

-- RPC signature lives in 20260405210000_pharmacy_dispensed_today_hospital_param.sql (hospital_id param)
