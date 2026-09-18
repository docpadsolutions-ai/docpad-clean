-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408093938.

-- Create preauth request upsert function
CREATE OR REPLACE FUNCTION public.upsert_preauth_request(
  p_preauth_id UUID,
  p_patient_id UUID,
  p_encounter_id UUID,
  p_insurance_company_id UUID,
  p_coverage_id UUID,
  p_estimated_amount NUMERIC,
  p_clinical_summary TEXT,
  p_procedures JSONB,
  p_diagnosis JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_preauth_id UUID;
  v_hospital_id UUID;
BEGIN
  -- Get hospital_id from encounter
  SELECT hospital_id INTO v_hospital_id
  FROM opd_encounters
  WHERE id = p_encounter_id;

  -- Insert or update preauth request
  INSERT INTO preauth_requests (
    id,
    patient_id,
    encounter_id,
    coverage_id,
    hospital_id,
    estimated_amount,
    clinical_summary,
    requested_procedures,
    diagnosis_codes,
    status,
    created_at,
    updated_at
  )
  VALUES (
    COALESCE(p_preauth_id, gen_random_uuid()),
    p_patient_id,
    p_encounter_id,
    p_coverage_id,
    v_hospital_id,
    p_estimated_amount,
    p_clinical_summary,
    p_procedures,
    p_diagnosis,
    'draft',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    estimated_amount = EXCLUDED.estimated_amount,
    clinical_summary = EXCLUDED.clinical_summary,
    requested_procedures = EXCLUDED.requested_procedures,
    diagnosis_codes = EXCLUDED.diagnosis_codes,
    updated_at = NOW()
  RETURNING id INTO v_preauth_id;

  RETURN v_preauth_id;
END;
$$;
