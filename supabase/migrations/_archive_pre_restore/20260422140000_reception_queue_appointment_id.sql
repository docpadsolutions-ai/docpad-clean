-- Link walk-in reception rows to `appointments` when both are created together.

alter table public.reception_queue
  add column if not exists appointment_id uuid references public.appointments (id) on delete set null;

create index if not exists reception_queue_appointment_id_idx
  on public.reception_queue (appointment_id)
  where appointment_id is not null;
