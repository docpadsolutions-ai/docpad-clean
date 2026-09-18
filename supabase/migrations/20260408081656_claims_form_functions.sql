-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408081656.

-- Phase 1: Claims form functions

-- Get approved preauths available for claim creation
CREATE OR REPLACE FUNCTION public.get_approved_preauths_for_claims()
RETURNS TABLE (
  id uuid,
  patient_name text,
  request_number text,
  approved_amount numeric,
  approved_at timestamptz,
  valid_until date,
  insurance_company_name text,
  has_claim boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.id,
    p.full_name as patient_name,
    pr.request_number,
    pr.approved_amount,
    pr.approved_at,
    pr.valid_until,
    ic.name as insurance_company_name,
    EXISTS(SELECT 1 FROM insurance_claims WHERE preauth_id = pr.id) as has_claim
  FROM preauth_requests pr
  JOIN patients p ON p.id = pr.patient_id
  JOIN patient_insurance_coverage pic ON pic.id = pr.coverage_id
  LEFT JOIN insurance_companies ic ON ic.id = pic.insurance_company_id
  WHERE pr.status = 'approved'
  AND pr.hospital_id::text = auth.jwt() ->> 'hospital_id'
  AND (pr.valid_until IS NULL OR pr.valid_until >= CURRENT_DATE)
  ORDER BY pr.approved_at DESC;
END;
$$;

-- Create claim from preauth
CREATE OR REPLACE FUNCTION public.create_claim_from_preauth(
  p_preauth_id uuid,
  p_invoice_id uuid,
  p_claim_type text DEFAULT 'cashless'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id uuid;
  v_patient_id uuid;
  v_encounter_id uuid;
  v_coverage_id uuid;
  v_approved_amount numeric;
  v_claim_number text;
  v_claim_id uuid;
BEGIN
  v_hospital_id := (auth.jwt() ->> 'hospital_id')::uuid;
  
  -- Get preauth details
  SELECT 
    patient_id, encounter_id, coverage_id, approved_amount
  INTO v_patient_id, v_encounter_id, v_coverage_id, v_approved_amount
  FROM preauth_requests
  WHERE id = p_preauth_id
  AND hospital_id = v_hospital_id
  AND status = 'approved';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preauth not found or not approved';
  END IF;
  
  -- Check if claim already exists
  IF EXISTS(SELECT 1 FROM insurance_claims WHERE preauth_id = p_preauth_id) THEN
    RAISE EXCEPTION 'Claim already exists for this preauth';
  END IF;
  
  -- Generate claim number
  v_claim_number := 'CLM-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::text, 4, '0');
  
  -- Create claim
  INSERT INTO insurance_claims (
    hospital_id,
    patient_id,
    encounter_id,
    coverage_id,
    preauth_id,
    claim_number,
    claim_type,
    invoice_id,
    claimed_amount,
    status
  ) VALUES (
    v_hospital_id,
    v_patient_id,
    v_encounter_id,
    v_coverage_id,
    p_preauth_id,
    v_claim_number,
    p_claim_type,
    p_invoice_id,
    v_approved_amount,
    'draft'
  )
  RETURNING id INTO v_claim_id;
  
  RETURN v_claim_id;
END;
$$;

-- Update claim
CREATE OR REPLACE FUNCTION public.update_insurance_claim(
  p_claim_id uuid,
  p_claimed_amount numeric DEFAULT NULL,
  p_invoice_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE insurance_claims
  SET 
    claimed_amount = COALESCE(p_claimed_amount, claimed_amount),
    invoice_id = COALESCE(p_invoice_id, invoice_id),
    updated_at = NOW()
  WHERE id = p_claim_id
  AND hospital_id::text = auth.jwt() ->> 'hospital_id'
  AND status = 'draft';
  
  RETURN FOUND;
END;
$$;

-- Submit claim
CREATE OR REPLACE FUNCTION public.submit_insurance_claim(p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id uuid;
BEGIN
  v_practitioner_id := (auth.jwt() ->> 'sub')::uuid;
  
  UPDATE insurance_claims
  SET 
    status = 'submitted',
    submitted_by = v_practitioner_id,
    submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_claim_id
  AND hospital_id::text = auth.jwt() ->> 'hospital_id'
  AND status = 'draft';
  
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_approved_preauths_for_claims() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_claim_from_preauth(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_insurance_claim(uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_insurance_claim(uuid) TO authenticated;
