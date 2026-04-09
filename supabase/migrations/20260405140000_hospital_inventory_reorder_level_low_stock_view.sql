-- Reorder threshold per formulary row; pharmacy dashboard compares to stock_quantity
alter table public.hospital_inventory add column if not exists reorder_level integer not null default 25;

drop view if exists public.pharmacy_low_stock_items;

create view public.pharmacy_low_stock_items as
select hi.*
from public.hospital_inventory hi
where coalesce(hi.stock_quantity, 0) < hi.reorder_level;

comment on view public.pharmacy_low_stock_items is 'Rows where stock_quantity < reorder_level (read-only; use for pharmacy warnings).';
