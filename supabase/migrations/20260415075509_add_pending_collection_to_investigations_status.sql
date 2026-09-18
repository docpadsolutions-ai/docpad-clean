-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415075509.

ALTER TABLE investigations 
DROP CONSTRAINT IF EXISTS investigations_status_check;

ALTER TABLE investigations 
ADD CONSTRAINT investigations_status_check 
CHECK (status = ANY (ARRAY[
  'draft', 'active', 'completed', 'revoked', 'unknown',
  'ordered', 'pending_collection', 'collected', 'resulted', 'reviewed', 'cancelled'
]));
