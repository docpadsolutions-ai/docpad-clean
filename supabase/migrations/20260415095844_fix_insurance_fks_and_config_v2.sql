-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415095844.

-- Fix FKs on insurance_preauths (the real table behind preauth_requests view)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_preauths_coverage_id_fkey') THEN
    ALTER TABLE insurance_preauths 
      ADD CONSTRAINT insurance_preauths_coverage_id_fkey 
      FOREIGN KEY (coverage_id) REFERENCES patient_insurance_coverage(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_preauths_patient_id_fkey') THEN
    ALTER TABLE insurance_preauths 
      ADD CONSTRAINT insurance_preauths_patient_id_fkey 
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_preauths_encounter_id_fkey') THEN
    ALTER TABLE insurance_preauths 
      ADD CONSTRAINT insurance_preauths_encounter_id_fkey 
      FOREIGN KEY (encounter_id) REFERENCES opd_encounters(id) ON DELETE SET NULL;
  END IF;
END $$;

-- insurance_claims FKs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_claims_coverage_id_fkey') THEN
    ALTER TABLE insurance_claims 
      ADD CONSTRAINT insurance_claims_coverage_id_fkey 
      FOREIGN KEY (coverage_id) REFERENCES patient_insurance_coverage(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_claims_patient_id_fkey') THEN
    ALTER TABLE insurance_claims 
      ADD CONSTRAINT insurance_claims_patient_id_fkey 
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_claims_encounter_id_fkey') THEN
    ALTER TABLE insurance_claims 
      ADD CONSTRAINT insurance_claims_encounter_id_fkey 
      FOREIGN KEY (encounter_id) REFERENCES opd_encounters(id) ON DELETE SET NULL;
  END IF;
END $$;

-- patient_insurance_coverage FKs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_insurance_coverage_patient_id_fkey') THEN
    ALTER TABLE patient_insurance_coverage 
      ADD CONSTRAINT patient_insurance_coverage_patient_id_fkey 
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_insurance_coverage_insurance_company_id_fkey') THEN
    ALTER TABLE patient_insurance_coverage 
      ADD CONSTRAINT patient_insurance_coverage_insurance_company_id_fkey 
      FOREIGN KEY (insurance_company_id) REFERENCES insurance_companies(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_insurance_coverage_tpa_id_fkey') THEN
    ALTER TABLE patient_insurance_coverage 
      ADD CONSTRAINT patient_insurance_coverage_tpa_id_fkey 
      FOREIGN KEY (tpa_id) REFERENCES tpas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- hospital_insurance_config: per-hospital insurer/TPA/scheme settings
CREATE TABLE IF NOT EXISTS hospital_insurance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  insurance_company_id uuid REFERENCES insurance_companies(id) ON DELETE CASCADE,
  tpa_id uuid REFERENCES tpas(id) ON DELETE SET NULL,
  scheme_type text NOT NULL DEFAULT 'tpa',
  scheme_name text,
  empanelment_number text,
  portal_url text,
  submission_mode text DEFAULT 'manual',
  is_active boolean DEFAULT true,
  config_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE hospital_insurance_config ENABLE ROW LEVEL SECURITY;

-- RLS using hospital_id join via practitioners/users table
CREATE POLICY "hospital_staff_insurance_config" ON hospital_insurance_config
  USING (
    hospital_id IN (
      SELECT DISTINCT hospital_id FROM opd_encounters 
      WHERE doctor_id = auth.uid()
      UNION
      SELECT id FROM hospitals WHERE id = hospital_id
    )
  );

NOTIFY pgrst, 'reload schema';
