-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408180317.

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
  WITH filtered_drugs AS (
    SELECT 
      d.id,
      d.generic_name,
      d.brand_name,
      d.dosage_form as form,
      d.strength,
      d.mrp,
      d.min_stock_level as min_stock,
      COALESCE(
        (SELECT SUM(hi.stock_quantity) 
         FROM hospital_inventory hi
         WHERE hi.drug_id = d.id), 
        0
      )::integer as current_stock,
      CASE 
        WHEN COALESCE(
          (SELECT SUM(hi.stock_quantity) 
           FROM hospital_inventory hi
           WHERE hi.drug_id = d.id), 
          0
        ) <= d.min_stock_level THEN 'low_stock'
        WHEN COALESCE(
          (SELECT SUM(hi.stock_quantity) 
           FROM hospital_inventory hi
           WHERE hi.drug_id = d.id), 
          0
        ) = 0 THEN 'out_of_stock'
        ELSE 'in_stock'
      END as status
    FROM drugs d
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
