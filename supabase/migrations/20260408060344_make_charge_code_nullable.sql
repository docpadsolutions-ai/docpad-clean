-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408060344.

ALTER TABLE charge_items 
ALTER COLUMN charge_code DROP NOT NULL;
