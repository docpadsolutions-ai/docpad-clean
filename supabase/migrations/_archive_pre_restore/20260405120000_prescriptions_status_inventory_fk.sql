-- Phase 1 pharmacy: queue by status; optional link to formulary row for joins in API
alter table public.prescriptions add column if not exists status text not null default 'active';

alter table public.prescriptions add column if not exists hospital_inventory_id uuid;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'hospital_inventory'
  ) and not exists (
    select 1 from pg_constraint where conname = 'prescriptions_hospital_inventory_id_fkey'
  ) then
    alter table public.prescriptions
      add constraint prescriptions_hospital_inventory_id_fkey
      foreign key (hospital_inventory_id) references public.hospital_inventory (id) on delete set null;
  end if;
end $$;

create index if not exists prescriptions_status_idx on public.prescriptions (status);

comment on column public.prescriptions.status is 'Workflow e.g. active, ordered, dispensing, dispensed, cancelled — pharmacy dashboard lists ordered.';
comment on column public.prescriptions.hospital_inventory_id is 'Optional FK to hospital_inventory for formulary/stock context; embed in Supabase select.';
