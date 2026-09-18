-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408055949.

-- Drop old foreign key to billing_accounts
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_account_id_fkey;

-- Keep only the new fk_invoices_account constraint (points to accounts table);
