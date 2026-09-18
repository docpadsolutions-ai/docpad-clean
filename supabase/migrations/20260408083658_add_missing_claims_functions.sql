-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408083658.

-- Get single claim for editing
CREATE OR REPLACE FUNCTION public.get_claim_by_id(claim_id uuid)
RETURNS TABLE (
  id uuid,
  patient_id uuid,
  patient_name text,
  claim_number text,
  claim_type text,
  invoice_id uuid,
  preauth_id uuid,
  preauth_request_number text,
  total_billed_amount numeric,
  claimed_amount numeric,
  approved_amount numeric,
  settled_amount numeric,
  status text,
  claim_date timestamptz,
  insurance_company_name text,
  tpa_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ic.id,
    ic.patient_id,
    p.full_name as patient_name,
    ic.claim_number,
    ic.claim_type,
    ic.invoice_id,
    ic.preauth_id,
    pr.request_number as preauth_request_number,
    ic.total_billed_amount,
    ic.claimed_amount,
    ic.approved_amount,
    ic.settled_amount,
    ic.status,
    ic.claim_date,
    ins.name as insurance_company_name,
    t.name as tpa_name
  FROM insurance_claims ic
  JOIN patients p ON p.id = ic.patient_id
  LEFT JOIN preauth_requests pr ON pr.id = ic.preauth_id
  LEFT JOIN patient_insurance_coverage pic ON pic.id = ic.coverage_id
  LEFT JOIN insurance_companies ins ON ins.id = pic.insurance_company_id
  LEFT JOIN tpas t ON t.id = pic.tpa_id
  WHERE ic.id = claim_id
  AND ic.hospital_id::text = auth.jwt() ->> 'hospital_id';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_claim_by_id(uuid) TO authenticated;
