-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417174031.

ALTER TABLE ipd_investigation_orders 
  ADD COLUMN IF NOT EXISTS expected_tat_hrs numeric(5,1);

NOTIFY pgrst, 'reload schema';
