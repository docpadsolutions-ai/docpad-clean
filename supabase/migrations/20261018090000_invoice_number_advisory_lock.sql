-- trg_set_invoice_number() allocates max(sequence) + 1 per hospital and year. Two
-- invoices saved at the same moment in one hospital both read the same max and get the
-- same number; the second then fails on invoices_hospital_id_invoice_number_key. No
-- duplicate is ever stored, but the second save errors and has to be retried, which is
-- realistic with several billing desks or bulk billing at discharge.
--
-- The function now takes a transaction-scoped advisory lock on (hospital, year) before
-- reading the max, so concurrent saves in the same hospital queue for a few
-- milliseconds instead of colliding. Numbers stay consecutive per hospital, which a
-- sequence would not give. The lock is released at commit or rollback. Other hospitals
-- never wait on each other.
--
-- The lock key is 'invoice_number:<hospital_id>:<year>'; scripts/test-invoice-number-lock.mjs
-- builds the same key to prove the trigger takes it.
--
-- The body is otherwise the live definition as read on 18 Oct 2026, unchanged. Note it
-- still resets every calendar year; whether it should reset on 1 April (GST financial
-- year) is an open business decision, not changed here.
--
-- Rollback: supabase/rollbacks/20261018090000_invoice_number_advisory_lock_rollback.sql

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

  perform pg_advisory_xact_lock(hashtext('invoice_number:' || new.hospital_id::text || ':' || y));

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
