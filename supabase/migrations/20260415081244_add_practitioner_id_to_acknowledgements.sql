-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415081244.

ALTER TABLE investigation_acknowledgements 
ADD COLUMN IF NOT EXISTS practitioner_id UUID REFERENCES practitioners(id);

-- Also create index for query performance
CREATE INDEX IF NOT EXISTS idx_inv_ack_practitioner 
ON investigation_acknowledgements(practitioner_id);
