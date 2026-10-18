-- Restores trg_set_invoice_number() without the advisory lock added by
-- 20261018090000_invoice_number_advisory_lock.sql (live definition read 18 Oct 2026).
-- Brings back the concurrent-save collision.

create or replace function public.trg_set_invoice_number()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  next_n int;
  y text;
begin
  if new.invoice_number is not null and btrim(new.invoice_number) <> '' then
    return new;
  end if;
  y := to_char(coalesce(new.invoice_date, timezone('utc', now())) at time zone 'utc', 'YYYY');
  select coalesce(max(split_part(i.invoice_number, '-', 3)::int), 0) + 1
  into next_n
  from public.invoices i
  where i.hospital_id = new.hospital_id
    and i.invoice_number ~ '^INV-[0-9]{4}-[0-9]+$'
    and split_part(i.invoice_number, '-', 2) = y
    and i.id is distinct from new.id;

  new.invoice_number := 'INV-' || y || '-' || lpad(next_n::text, 6, '0');
  return new;
end;
$function$;
