-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415081312.

ALTER TABLE investigation_acknowledgements 
ADD COLUMN IF NOT EXISTS reason TEXT;
