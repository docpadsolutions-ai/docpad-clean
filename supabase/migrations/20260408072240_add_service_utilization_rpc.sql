-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408072240.

-- Service utilization metrics
CREATE OR REPLACE FUNCTION get_service_utilization(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  service_name text,
  category text,
  usage_count bigint,
  total_revenue numeric,
  avg_price numeric,
  margin_percent numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.service_name,
    s.category,
    COUNT(ci.id) as usage_count,
    COALESCE(SUM(ci.net_amount), 0) as total_revenue,
    CASE WHEN COUNT(ci.id) > 0 
      THEN COALESCE(SUM(ci.net_amount) / COUNT(ci.id), 0)
      ELSE 0 
    END as avg_price,
    CASE WHEN s.standard_rate > 0 AND s.cost_basis IS NOT NULL
      THEN ROUND(((s.standard_rate - s.cost_basis) / s.standard_rate * 100)::numeric, 2)
      ELSE NULL 
    END as margin_percent
  FROM services s
  LEFT JOIN charge_items ci ON ci.service_id = s.id 
    AND ci.created_at::date BETWEEN p_start_date AND p_end_date
  WHERE s.hospital_id = p_hospital_id AND s.is_active = true
  GROUP BY s.id, s.service_name, s.category, s.standard_rate, s.cost_basis
  ORDER BY total_revenue DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
