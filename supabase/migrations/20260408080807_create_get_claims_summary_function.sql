-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408080807.

CREATE OR REPLACE FUNCTION public.get_claims_summary()
RETURNS TABLE (
  total_claims bigint,
  total_claimed_amount numeric,
  total_approved_amount numeric,
  total_settled_amount numeric,
  approval_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint as total_claims,
    COALESCE(SUM(claimed_amount), 0)::numeric as total_claimed_amount,
    COALESCE(SUM(approved_amount), 0)::numeric as total_approved_amount,
    COALESCE(SUM(settled_amount), 0)::numeric as total_settled_amount,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE status = 'approved' OR status = 'settled')::numeric / COUNT(*)::numeric * 100), 2)
      ELSE 0 
    END as approval_rate
  FROM insurance_claims
  WHERE hospital_id::text = auth.jwt() ->> 'hospital_id';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_claims_summary() TO authenticated;
