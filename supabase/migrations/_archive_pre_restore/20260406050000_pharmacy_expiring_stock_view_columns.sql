-- View: no bare `id` (inventory is inventory_item_id); restock line id is restock_line_id for mark_expired_stock().
drop view if exists public.pharmacy_expiring_stock;

create view public.pharmacy_expiring_stock as
select
  hi.hospital_id,
  hi.id as inventory_item_id,
  r.id as restock_line_id,
  hi.brand_name,
  hi.generic_name,
  r.batch_number,
  r.expiry_date,
  (r.expiry_date - current_date)::integer as days_left,
  r.quantity
from public.hospital_inventory_restock r
inner join public.hospital_inventory hi on hi.id = r.hospital_inventory_id
where r.expiry_date is not null
  and r.expired_disposed_at is null
  and r.expiry_date >= current_date
  and r.expiry_date <= current_date + 30;

comment on view public.pharmacy_expiring_stock is
  'Expiring batches (30d): hospital_id, inventory_item_id, restock_line_id, batch/expiry/qty; use restock_line_id for mark_expired_stock.';

grant select on public.pharmacy_expiring_stock to authenticated;
