-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408081632.

-- Phase 1: Preauth form functions

-- Get single preauth for editing
CREATE OR REPLACE FUNCTION public.get_preauth_by_id(preauth_id uuid)
RETURNS TABLE (
  id uuid,
  patient_id uuid,
  patient_name text,
  coverage_id uuid,
  policy_number text,
  insurance_company_name text,
  tpa_name text,
  request_number text,
  estimated_amount numeric,
  requested_procedures jsonb,
  clinical_summary text,
  diagnosis_codes jsonb,
  status text,
  request_date timestamptz,
  valid_until date,
  approved_amount numeric,
  rejection_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.id,
    pr.patient_id,
    p.full_name as patient_name,
    pr.coverage_id,
    pic.policy_number,
    ic.name as insurance_company_name,
    t.name as tpa_name,
    pr.request_number,
    pr.estimated_amount,
    pr.requested_procedures,
    pr.clinical_summary,
    pr.diagnosis_codes,
    pr.status,
    pr.request_date,
    pr.valid_until,
    pr.approved_amount,
    pr.rejection_reason
  FROM preauth_requests pr
  JOIN patients p ON p.id = pr.patient_id
  JOIN patient_insurance_coverage pic ON pic.id = pr.coverage_id
  LEFT JOIN insurance_companies ic ON ic.id = pic.insurance_company_id
  LEFT JOIN tpas t ON t.id = pic.tpa_id
  WHERE pr.id = preauth_id
  AND pr.hospital_id::text = auth.jwt() ->> 'hospital_id';
END;
$$;

-- Get patient's active insurance coverage
CREATE OR REPLACE FUNCTION public.get_patient_insurance_coverage(p_patient_id uuid)
RETURNS TABLE (
  id uuid,
  policy_number text,
  insurance_company_id uuid,
  insurance_company_name text,
  tpa_id uuid,
  tpa_name text,
  sum_insured numeric,
  balance_sum_insured numeric,
  status text,
  coverage_end_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pic.id,
    pic.policy_number,
    pic.insurance_company_id,
    ic.name as insurance_company_name,
    pic.tpa_id,
    t.name as tpa_name,
    pic.sum_insured,
    pic.balance_sum_insured,
    pic.status,
    pic.coverage_end_date
  FROM patient_insurance_coverage pic
  LEFT JOIN insurance_companies ic ON ic.id = pic.insurance_company_id
  LEFT JOIN tpas t ON t.id = pic.tpa_id
  WHERE pic.patient_id = p_patient_id
  AND pic.status = 'active'
  ORDER BY pic.created_at DESC;
END;
$$;

-- Create or update preauth
CREATE OR REPLACE FUNCTION public.upsert_preauth_request(
  p_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL,
  p_encounter_id uuid DEFAULT NULL,
  p_coverage_id uuid DEFAULT NULL,
  p_estimated_amount numeric DEFAULT NULL,
  p_requested_procedures jsonb DEFAULT NULL,
  p_clinical_summary text DEFAULT NULL,
  p_diagnosis_codes jsonb DEFAULT NULL,
  p_supporting_documents jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id uuid;
  v_request_number text;
  v_result_id uuid;
BEGIN
  -- Get hospital_id from JWT
  v_hospital_id := (auth.jwt() ->> 'hospital_id')::uuid;
  
  -- Generate request number if new
  IF p_id IS NULL THEN
    v_request_number := 'PA-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::text, 4, '0');
  END IF;
  
  -- Insert or update
  INSERT INTO preauth_requests (
    id,
    hospital_id,
    patient_id,
    encounter_id,
    coverage_id,
    request_number,
    estimated_amount,
    requested_procedures,
    clinical_summary,
    diagnosis_codes,
    supporting_documents,
    status,
    request_date
  ) VALUES (
    COALESCE(p_id, gen_random_uuid()),
    v_hospital_id,
    p_patient_id,
    p_encounter_id,
    p_coverage_id,
    COALESCE(v_request_number, (SELECT request_number FROM preauth_requests WHERE id = p_id)),
    p_estimated_amount,
    p_requested_procedures,
    p_clinical_summary,
    p_diagnosis_codes,
    p_supporting_documents,
    COALESCE((SELECT status FROM preauth_requests WHERE id = p_id), 'draft'),
    COALESCE((SELECT request_date FROM preauth_requests WHERE id = p_id), NOW())
  )
  ON CONFLICT (id) DO UPDATE SET
    patient_id = EXCLUDED.patient_id,
    encounter_id = EXCLUDED.encounter_id,
    coverage_id = EXCLUDED.coverage_id,
    estimated_amount = EXCLUDED.estimated_amount,
    requested_procedures = EXCLUDED.requested_procedures,
    clinical_summary = EXCLUDED.clinical_summary,
    diagnosis_codes = EXCLUDED.diagnosis_codes,
    supporting_documents = EXCLUDED.supporting_documents,
    updated_at = NOW()
  RETURNING id INTO v_result_id;
  
  RETURN v_result_id;
END;
$$;

-- Submit preauth (change status to submitted)
CREATE OR REPLACE FUNCTION public.submit_preauth_request(p_preauth_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id uuid;
BEGIN
  -- Get practitioner_id from JWT
  v_practitioner_id := (auth.jwt() ->> 'sub')::uuid;
  
  UPDATE preauth_requests
  SET 
    status = 'submitted',
    submitted_by = v_practitioner_id,
    submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_preauth_id
  AND hospital_id::text = auth.jwt() ->> 'hospital_id'
  AND status = 'draft';
  
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_preauth_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_patient_insurance_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_preauth_request(uuid, uuid, uuid, uuid, numeric, jsonb, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_preauth_request(uuid) TO authenticated;
