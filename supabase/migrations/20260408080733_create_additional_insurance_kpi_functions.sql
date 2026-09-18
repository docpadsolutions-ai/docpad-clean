-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408080733.

-- Create individual KPI functions for insurance billing

CREATE OR REPLACE FUNCTION public.get_pending_preauths()
RETURNS TABLE (
  id uuid,
  patient_name text,
  request_number text,
  estimated_amount numeric,
  status text,
  request_date timestamptz,
  days_pending integer
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
    pr.estimated_amount,
    pr.status,
    pr.request_date,
    EXTRACT(DAY FROM NOW() - pr.request_date)::integer as days_pending
  FROM preauth_requests pr
  JOIN patients p ON p.id = pr.patient_id
  WHERE pr.status IN ('draft', 'submitted', 'pending')
  AND pr.hospital_id::text = auth.jwt() ->> 'hospital_id'
  ORDER BY pr.request_date DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_claims_in_review()
RETURNS TABLE (
  id uuid,
  patient_name text,
  claim_number text,
  claimed_amount numeric,
  status text,
  claim_date timestamptz,
  days_pending integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ic.id,
    p.full_name as patient_name,
    ic.claim_number,
    ic.claimed_amount,
    ic.status,
    ic.claim_date,
    EXTRACT(DAY FROM NOW() - ic.claim_date)::integer as days_pending
  FROM insurance_claims ic
  JOIN patients p ON p.id = ic.patient_id
  WHERE ic.status IN ('submitted', 'under_review', 'query_raised')
  AND ic.hospital_id::text = auth.jwt() ->> 'hospital_id'
  ORDER BY ic.claim_date DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_settlement_due()
RETURNS TABLE (
  id uuid,
  patient_name text,
  claim_number text,
  approved_amount numeric,
  approved_at timestamptz,
  days_pending integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ic.id,
    p.full_name as patient_name,
    ic.claim_number,
    ic.approved_amount,
    ic.approved_at,
    EXTRACT(DAY FROM NOW() - ic.approved_at)::integer as days_pending
  FROM insurance_claims ic
  JOIN patients p ON p.id = ic.patient_id
  WHERE ic.status = 'approved'
  AND ic.settled_at IS NULL
  AND ic.hospital_id::text = auth.jwt() ->> 'hospital_id'
  ORDER BY ic.approved_at ASC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_pending_preauths() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_claims_in_review() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_settlement_due() TO authenticated;
