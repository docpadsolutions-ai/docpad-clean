-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408151729.

-- Enable direct join from preauth_requests to insurance_companies via coverage
-- Path: preauth_requests.coverage_id → patient_insurance_coverage.id → patient_insurance_coverage.insurance_company_id → insurance_companies.id

-- Verify foreign key exists on patient_insurance_coverage
ALTER TABLE patient_insurance_coverage 
  DROP CONSTRAINT IF EXISTS patient_insurance_coverage_insurance_company_id_fkey;

ALTER TABLE patient_insurance_coverage
  ADD CONSTRAINT patient_insurance_coverage_insurance_company_id_fkey
  FOREIGN KEY (insurance_company_id) 
  REFERENCES insurance_companies(id) 
  ON DELETE SET NULL;
