-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408151832.

-- Add foreign key from preauth_requests.coverage_id to patient_insurance_coverage.id
ALTER TABLE preauth_requests 
  DROP CONSTRAINT IF EXISTS preauth_requests_coverage_id_fkey;

ALTER TABLE preauth_requests
  ADD CONSTRAINT preauth_requests_coverage_id_fkey
  FOREIGN KEY (coverage_id) 
  REFERENCES patient_insurance_coverage(id) 
  ON DELETE SET NULL;
