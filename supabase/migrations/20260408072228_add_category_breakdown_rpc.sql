-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408072228.

-- Category breakdown for pie chart
CREATE OR REPLACE FUNCTION get_revenue_breakdown_by_category(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  category text,
  revenue numeric,
  percentage numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH totals AS (
    SELECT 
      ci.category,
      COALESCE(SUM(ci.net_amount), 0) as cat_revenue
    FROM charge_items ci
    WHERE ci.hospital_id = p_hospital_id
      AND ci.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY ci.category
  ),
  grand_total AS (
    SELECT SUM(cat_revenue) as total FROM totals
  )
  SELECT 
    t.category,
    t.cat_revenue,
    CASE WHEN gt.total > 0 
      THEN ROUND((t.cat_revenue / gt.total * 100)::numeric, 2)
      ELSE 0 
    END as percentage
  FROM totals t
  CROSS JOIN grand_total gt
  ORDER BY t.cat_revenue DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
