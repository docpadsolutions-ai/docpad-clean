-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408080242.

CREATE OR REPLACE FUNCTION get_insurance_billing_kpis(
  p_hospital_id uuid
)
RETURNS TABLE(
  pending_preauths_count bigint,
  pending_preauths_amount numeric,
  claims_in_review_count bigint,
  settlement_due_amount numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM preauth_requests WHERE hospital_id = p_hospital_id AND status IN ('submitted', 'pending')),
    (SELECT COALESCE(SUM(estimated_amount), 0) FROM preauth_requests WHERE hospital_id = p_hospital_id AND status IN ('submitted', 'pending')),
    (SELECT COUNT(*) FROM insurance_claims WHERE hospital_id = p_hospital_id AND status IN ('submitted', 'under_review', 'query_raised')),
    (SELECT COALESCE(SUM(approved_amount - settled_amount), 0) FROM insurance_claims WHERE hospital_id = p_hospital_id AND status = 'approved' AND settled_amount < approved_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
