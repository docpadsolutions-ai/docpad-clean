-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260427052208.

-- Migration: Add prescription_header_config and enabled_modules to hospitals

ALTER TABLE hospitals
ADD COLUMN IF NOT EXISTS prescription_header_config JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS enabled_modules JSONB DEFAULT '{
  "opd": true,
  "pharmacy": true,
  "lab": true,
  "ipd": true,
  "billing": true
}'::jsonb;

COMMENT ON COLUMN hospitals.prescription_header_config IS 'Clinic branding for printed prescriptions: doctor_name, qualifications, designation, reg_number, clinic_name, address, phone, email, timings, logo_url';
COMMENT ON COLUMN hospitals.enabled_modules IS 'Per-hospital module toggles. Frontend nav gates visibility based on these flags.';
