-- Total dispensable units per Rx line (frequency × duration / 1-0-1 parsing in app)
alter table public.prescriptions add column if not exists total_quantity integer not null default 1;
