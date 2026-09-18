-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408074240.

-- Auto-check if preauth required when encounter created
CREATE OR REPLACE FUNCTION check_preauth_requirement()
RETURNS TRIGGER AS $$
DECLARE
  v_coverage_id uuid;
  v_panel_id uuid;
  v_requires_preauth boolean;
  v_threshold numeric;
BEGIN
  -- Check if patient has active insurance
  SELECT id, corporate_panel_id INTO v_coverage_id, v_panel_id
  FROM patient_insurance_coverage
  WHERE patient_id = NEW.patient_id
    AND status = 'active'
    AND (coverage_end_date IS NULL OR coverage_end_date >= CURRENT_DATE)
  LIMIT 1;
  
  IF v_coverage_id IS NOT NULL THEN
    -- Get panel preauth rules
    SELECT requires_preauth, preauth_mandatory_above_amount 
    INTO v_requires_preauth, v_threshold
    FROM corporate_panels
    WHERE id = v_panel_id;
    
    -- Flag encounter for preauth if required
    IF v_requires_preauth THEN
      NEW.payment_status := 'insurance';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_check_preauth ON opd_encounters;
CREATE TRIGGER trigger_check_preauth
  BEFORE INSERT ON opd_encounters
  FOR EACH ROW
  EXECUTE FUNCTION check_preauth_requirement();

-- Get patient insurance eligibility
CREATE OR REPLACE FUNCTION get_patient_insurance_eligibility(
  p_patient_id uuid
)
RETURNS TABLE(
  coverage_id uuid,
  policy_number text,
  insurance_name text,
  tpa_name text,
  sum_insured numeric,
  balance_available numeric,
  valid_until date,
  requires_preauth boolean,
  preauth_threshold numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pic.id,
    pic.policy_number,
    ic.name,
    t.name,
    pic.sum_insured,
    pic.balance_sum_insured,
    pic.coverage_end_date,
    cp.requires_preauth,
    cp.preauth_mandatory_above_amount
  FROM patient_insurance_coverage pic
  LEFT JOIN insurance_companies ic ON ic.id = pic.insurance_company_id
  LEFT JOIN tpas t ON t.id = pic.tpa_id
  LEFT JOIN corporate_panels cp ON cp.id = pic.corporate_panel_id
  WHERE pic.patient_id = p_patient_id
    AND pic.status = 'active'
    AND (pic.coverage_end_date IS NULL OR pic.coverage_end_date >= CURRENT_DATE)
  ORDER BY pic.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Submit preauth (changes status to submitted)
CREATE OR REPLACE FUNCTION submit_preauth(
  p_preauth_id uuid,
  p_submitted_by uuid
)
RETURNS jsonb AS $$
DECLARE
  v_request_number text;
  v_result jsonb;
BEGIN
  -- Generate request number if not exists
  SELECT request_number INTO v_request_number
  FROM preauth_requests
  WHERE id = p_preauth_id;
  
  IF v_request_number IS NULL THEN
    v_request_number := 'PRE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('preauth_seq')::text, 6, '0');
  END IF;
  
  -- Update status
  UPDATE preauth_requests
  SET 
    status = 'submitted',
    request_number = v_request_number,
    submitted_by = p_submitted_by,
    submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_preauth_id
  RETURNING json_build_object(
    'success', true,
    'request_number', request_number,
    'status', status
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Submit insurance claim
CREATE OR REPLACE FUNCTION submit_insurance_claim(
  p_claim_id uuid,
  p_submitted_by uuid
)
RETURNS jsonb AS $$
DECLARE
  v_claim_number text;
  v_result jsonb;
BEGIN
  -- Generate claim number
  SELECT claim_number INTO v_claim_number
  FROM insurance_claims
  WHERE id = p_claim_id;
  
  IF v_claim_number IS NULL THEN
    v_claim_number := 'CLM-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('claim_seq')::text, 6, '0');
  END IF;
  
  UPDATE insurance_claims
  SET 
    status = 'submitted',
    claim_number = v_claim_number,
    submitted_by = p_submitted_by,
    submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_claim_id
  RETURNING json_build_object(
    'success', true,
    'claim_number', claim_number,
    'status', status
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dashboard: Pending preauths
CREATE OR REPLACE FUNCTION get_pending_preauths(
  p_hospital_id uuid
)
RETURNS TABLE(
  preauth_id uuid,
  request_number text,
  patient_name text,
  insurance_name text,
  estimated_amount numeric,
  status text,
  days_pending int,
  request_date timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.id,
    pr.request_number,
    p.full_name,
    ic.name,
    pr.estimated_amount,
    pr.status,
    EXTRACT(DAY FROM NOW() - pr.request_date)::int,
    pr.request_date
  FROM preauth_requests pr
  JOIN patients p ON p.id = pr.patient_id
  JOIN patient_insurance_coverage pic ON pic.id = pr.coverage_id
  LEFT JOIN insurance_companies ic ON ic.id = pic.insurance_company_id
  WHERE pr.hospital_id = p_hospital_id
    AND pr.status IN ('submitted', 'pending')
  ORDER BY pr.request_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dashboard: Claims summary
CREATE OR REPLACE FUNCTION get_claims_summary(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  status text,
  claim_count bigint,
  total_billed numeric,
  total_approved numeric,
  total_settled numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ic.status,
    COUNT(*),
    COALESCE(SUM(ic.total_billed_amount), 0),
    COALESCE(SUM(ic.approved_amount), 0),
    COALESCE(SUM(ic.settled_amount), 0)
  FROM insurance_claims ic
  WHERE ic.hospital_id = p_hospital_id
    AND ic.claim_date::date BETWEEN p_start_date AND p_end_date
  GROUP BY ic.status
  ORDER BY 
    CASE ic.status
      WHEN 'submitted' THEN 1
      WHEN 'under_review' THEN 2
      WHEN 'query_raised' THEN 3
      WHEN 'approved' THEN 4
      WHEN 'settled' THEN 5
      ELSE 6
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create sequences
CREATE SEQUENCE IF NOT EXISTS preauth_seq START 1;
CREATE SEQUENCE IF NOT EXISTS claim_seq START 1;
