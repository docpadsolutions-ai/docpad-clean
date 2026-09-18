-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415073609.

ALTER TABLE investigations ADD COLUMN IF NOT EXISTS sla_acknowledged_at TIMESTAMPTZ DEFAULT NULL;
