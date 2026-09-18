-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408180054.

CREATE OR REPLACE FUNCTION public.get_drugs(
  p_hospital_id uuid,
  p_page integer DEFAULT 1,
  p_search text DEFAULT ''
)
RETURNS TABLE(
  id uuid,
  generic_name text,
  brand_name text,
  form text,
  strength text,
  mrp numeric,
  min_stock integer,
  current_stock integer,
  status text,
  total_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_offset integer;
  v_limit integer := 50;
BEGIN
  v_offset := (p_page - 1) * v_limit;
  
  RETURN QUERY
  WITH drug_stocks AS (
    SELECT 
      hi.generic_name,
      hi.brand_name,
      SUM(hi.stock_quantity) as total_stock
    FROM hospital_inventory hi
    WHERE hi.hospital_id = p_hospital_id
      AND hi.is_active = true
    GROUP BY hi.generic_name, hi.brand_name
  ),
  filtered_drugs AS (
    SELECT 
      d.id,
      d.generic_name,
      d.brand_name,
      d.dosage_form as form,
      d.strength,
      d.mrp,
      d.min_stock_level as min_stock,
      COALESCE(ds.total_stock, 0)::integer as current_stock,
      CASE 
        WHEN COALESCE(ds.total_stock, 0) <= d.min_stock_level THEN 'low_stock'
        WHEN COALESCE(ds.total_stock, 0) = 0 THEN 'out_of_stock'
        ELSE 'in_stock'
      END as status
    FROM drugs d
    LEFT JOIN drug_stocks ds ON d.generic_name = ds.generic_name 
      AND d.brand_name = ds.brand_name
    WHERE d.hospital_id = p_hospital_id
      AND d.is_active = true
      AND (
        p_search = '' 
        OR d.generic_name ILIKE '%' || p_search || '%'
        OR d.brand_name ILIKE '%' || p_search || '%'
      )
  )
  SELECT 
    fd.*,
    (SELECT count(*) FROM filtered_drugs)::bigint as total_count
  FROM filtered_drugs fd
  ORDER BY fd.generic_name
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_drugs(uuid, integer, text) TO authenticated;
