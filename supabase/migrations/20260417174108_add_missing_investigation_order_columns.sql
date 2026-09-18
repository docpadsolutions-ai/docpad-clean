-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417174108.

ALTER TABLE ipd_investigation_orders
  ADD COLUMN IF NOT EXISTS sla_acknowledged_at timestamptz;

NOTIFY pgrst, 'reload schema';
