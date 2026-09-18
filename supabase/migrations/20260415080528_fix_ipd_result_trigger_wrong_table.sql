-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415080528.

-- Remove the trigger from lab_result_entries (it belongs only on ipd_investigation_orders)
DROP TRIGGER IF EXISTS trig_ipd_investigation_result ON lab_result_entries;
