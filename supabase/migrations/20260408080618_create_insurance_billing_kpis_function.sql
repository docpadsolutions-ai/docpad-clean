-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408080618.

-- Create the RPC function for insurance billing KPIs
CREATE OR REPLACE FUNCTION public.get_insurance_billing_kpis()
RETURNS TABLE (
  pending_preauths bigint,
  claims_in_review bigint,
  settlement_due numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    -- Count preauths that are pending/submitted/under review
    COUNT(*) FILTER (
      WHERE pr.status IN ('draft', 'submitted', 'pending', 'approved')
      AND pr.hospital_id::text = auth.jwt() ->> 'hospital_id'
    )::bigint as pending_preauths,
    
    -- Count claims in review (submitted but not yet approved/settled)
    COUNT(*) FILTER (
      WHERE ic.status IN ('submitted', 'under_review', 'query_raised')
      AND ic.hospital_id::text = auth.jwt() ->> 'hospital_id'
    )::bigint as claims_in_review,
    
    -- Sum approved amounts that haven't been settled yet
    COALESCE(
      SUM(ic.approved_amount) FILTER (
        WHERE ic.status = 'approved' 
        AND ic.settled_at IS NULL
        AND ic.hospital_id::text = auth.jwt() ->> 'hospital_id'
      ), 
      0
    )::numeric as settlement_due
    
  FROM preauth_requests pr
  FULL OUTER JOIN insurance_claims ic ON ic.preauth_id = pr.id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_insurance_billing_kpis() TO authenticated;

COMMENT ON FUNCTION public.get_insurance_billing_kpis() IS 
'Returns insurance billing KPIs: pending preauth count, claims in review count, and settlement due amount';
