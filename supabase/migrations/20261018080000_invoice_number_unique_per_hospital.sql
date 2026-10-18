-- Invoice numbers are allocated per hospital: trg_set_invoice_number() takes
-- max(sequence) + 1 over the same hospital and year, giving INV-2026-000001 upwards in
-- every hospital, and invoices_hospital_id_invoice_number_key enforces that pair.
--
-- A second, global index, invoices_invoice_number_key, also required the number to be
-- unique across all hospitals. All 18 existing invoices belong to one hospital, so it
-- never fired - but the first invoice in any other hospital is INV-2026-000001 again,
-- and fails with
--   duplicate key value violates unique constraint "invoices_invoice_number_key"
-- So no second hospital could raise an invoice (BREAKAGE-TRIAGE N-20). Found when the
-- billing suite picked a patient from the demo clinic.
--
-- Dropping the global index leaves per-hospital uniqueness in place. No application
-- code looks an invoice up by number alone.
--
-- Rollback: supabase/rollbacks/20261018080000_invoice_number_unique_per_hospital_rollback.sql

drop index public.invoices_invoice_number_key;
