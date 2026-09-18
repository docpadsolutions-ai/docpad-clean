-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408095102.

-- Update preauth status (for TPA webhooks)
CREATE OR REPLACE FUNCTION public.update_preauth_status(
  p_id UUID,
  p_status TEXT,
  p_approved_amount NUMERIC DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL,
  p_tpa_reference TEXT DEFAULT NULL,
  p_insurance_reference TEXT DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE preauth_requests
  SET 
    status = p_status,
    approved_amount = COALESCE(p_approved_amount, approved_amount),
    rejection_reason = COALESCE(p_rejection_reason, rejection_reason),
    tpa_reference_number = COALESCE(p_tpa_reference, tpa_reference_number),
    insurance_reference_number = COALESCE(p_insurance_reference, insurance_reference_number),
    valid_until = COALESCE(p_valid_until, valid_until),
    approved_at = CASE WHEN p_status = 'approved' THEN NOW() ELSE approved_at END,
    updated_at = NOW()
  WHERE id = p_id
  RETURNING jsonb_build_object(
    'id', id,
    'status', status,
    'approved_amount', approved_amount,
    'rejection_reason', rejection_reason
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Update claim status (for TPA webhooks)
CREATE OR REPLACE FUNCTION public.update_claim_status(
  p_id UUID,
  p_status TEXT,
  p_approved_amount NUMERIC DEFAULT NULL,
  p_settled_amount NUMERIC DEFAULT NULL,
  p_deductions NUMERIC DEFAULT NULL,
  p_deduction_reason TEXT DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL,
  p_query_remarks TEXT DEFAULT NULL,
  p_tpa_reference TEXT DEFAULT NULL,
  p_insurance_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE insurance_claims
  SET 
    status = p_status,
    approved_amount = COALESCE(p_approved_amount, approved_amount),
    settled_amount = COALESCE(p_settled_amount, settled_amount),
    deductions = COALESCE(p_deductions, deductions),
    deduction_reason = COALESCE(p_deduction_reason, deduction_reason),
    rejection_reason = COALESCE(p_rejection_reason, rejection_reason),
    query_remarks = COALESCE(p_query_remarks, query_remarks),
    tpa_reference_number = COALESCE(p_tpa_reference, tpa_reference_number),
    insurance_reference_number = COALESCE(p_insurance_reference, insurance_reference_number),
    settled_at = CASE WHEN p_status = 'settled' THEN NOW() ELSE settled_at END,
    updated_at = NOW()
  WHERE id = p_id
  RETURNING jsonb_build_object(
    'id', id,
    'status', status,
    'approved_amount', approved_amount,
    'settled_amount', settled_amount,
    'deductions', deductions
  ) INTO v_result;

  RETURN v_result;
END;
$$;
