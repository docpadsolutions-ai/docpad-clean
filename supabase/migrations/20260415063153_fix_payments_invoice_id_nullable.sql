-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415063153.

-- Make invoice_id nullable — lab payments at reception may not have an invoice yet
ALTER TABLE public.payments ALTER COLUMN invoice_id DROP NOT NULL;
