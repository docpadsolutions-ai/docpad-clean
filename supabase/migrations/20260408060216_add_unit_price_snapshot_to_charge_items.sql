-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408060216.

ALTER TABLE charge_items 
ADD COLUMN unit_price_snapshot NUMERIC(10,2);
