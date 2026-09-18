-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061252.

-- Drop old foreign key to billing_accounts
ALTER TABLE charge_items DROP CONSTRAINT IF EXISTS charge_items_account_id_fkey;

-- Add correct foreign key to accounts table
ALTER TABLE charge_items 
ADD CONSTRAINT fk_charge_items_account 
FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
