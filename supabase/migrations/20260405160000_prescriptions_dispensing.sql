-- Phase 3 pharmacy: record what was dispensed and optional notes (inventory unchanged)
alter table public.prescriptions add column if not exists dispensed_quantity integer;

alter table public.prescriptions add column if not exists dispensing_notes text;

comment on column public.prescriptions.dispensed_quantity is 'Units actually dispensed; may be less than total_quantity.';
comment on column public.prescriptions.dispensing_notes is 'Partial-dispense reason or other pharmacy notes.';
