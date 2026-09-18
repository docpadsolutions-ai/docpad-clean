-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414135727.

DROP FUNCTION IF EXISTS check_ddi_by_names(text[]);

CREATE FUNCTION check_ddi_by_names(p_generic_names text[])
RETURNS TABLE (
  drug_a text,
  drug_b text,
  severity text,
  description text,
  description_hi text,
  clinical_effect text,
  management text,
  severity_rank int
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH components AS (
    SELECT DISTINCT trim(lower(unnest(string_to_array(
      regexp_replace(gn, '\s*\(.*?\)', '', 'g'), '+'
    )))) as component
    FROM unnest(p_generic_names) as gn
    WHERE gn IS NOT NULL
  )
  SELECT DISTINCT
    di.drug_a_generic::text,
    di.drug_b_generic::text,
    di.severity::text,
    di.description::text,
    di.description_hi::text,
    di.clinical_effect::text,
    di.management::text,
    CASE di.severity 
      WHEN 'contraindicated' THEN 1 
      WHEN 'severe' THEN 2 
      WHEN 'moderate' THEN 3 
      WHEN 'mild' THEN 4 
    END as severity_rank
  FROM components a
  CROSS JOIN components b
  JOIN drug_interactions di ON (
    (lower(di.drug_a_generic) = a.component AND lower(di.drug_b_generic) = b.component)
    OR
    (lower(di.drug_a_generic) = b.component AND lower(di.drug_b_generic) = a.component)
  )
  WHERE a.component != b.component
  ORDER BY severity_rank;
END;
$$;
