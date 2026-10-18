-- Recreates the global invoice-number index dropped by
-- 20261018080000_invoice_number_unique_per_hospital.sql. Fails once two hospitals have
-- invoiced, since both start at INV-<year>-000001; that failure is the original bug.

create unique index invoices_invoice_number_key on public.invoices using btree (invoice_number)
  where (invoice_number is not null);
