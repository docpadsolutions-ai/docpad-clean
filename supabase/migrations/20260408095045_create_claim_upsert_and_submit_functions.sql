-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408095045.

-- Upsert claim
CREATE OR REPLACE FUNCTION public.upsert_claim(
  p_claim_id UUID,
  p_patient_id UUID,
  p_encounter_id UUID,
  p_coverage_id UUID,
  p_preauth_id UUID,
  p_invoice_id UUID,
  p_claimed_amount NUMERIC,
  p_claim_type TEXT DEFAULT 'institutional'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim_id UUID;
  v_hospital_id UUID;
BEGIN
  -- Get hospital_id from encounter
  SELECT hospital_id INTO v_hospital_id
  FROM opd_encounters
  WHERE id = p_encounter_id;

  -- Insert or update claim
  INSERT INTO insurance_claims (
    id,
    patient_id,
    encounter_id,
    coverage_id,
    preauth_id,
    invoice_id,
    hospital_id,
    claimed_amount,
    claim_type,
    status,
    created_at,
    updated_at
  )
  VALUES (
    COALESCE(p_claim_id, gen_random_uuid()),
    p_patient_id,
    p_encounter_id,
    p_coverage_id,
    p_preauth_id,
    p_invoice_id,
    v_hospital_id,
    p_claimed_amount,
    p_claim_type,
    'draft',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    claimed_amount = EXCLUDED.claimed_amount,
    invoice_id = EXCLUDED.invoice_id,
    updated_at = NOW()
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

-- Submit claim
CREATE OR REPLACE FUNCTION public.submit_claim(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim_number TEXT;
  v_result JSONB;
BEGIN
  -- Generate claim number if not exists
  SELECT claim_number INTO v_claim_number
  FROM insurance_claims
  WHERE id = p_id;
  
  IF v_claim_number IS NULL THEN
    v_claim_number := 'CLM-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;

  -- Update status to submitted
  UPDATE insurance_claims
  SET 
    status = 'submitted',
    claim_number = v_claim_number,
    claim_date = NOW(),
    submitted_at = NOW(),
    submitted_by = auth.uid(),
    updated_at = NOW()
  WHERE id = p_id
  RETURNING jsonb_build_object(
    'id', id,
    'claim_number', claim_number,
    'status', status,
    'submitted_at', submitted_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;
