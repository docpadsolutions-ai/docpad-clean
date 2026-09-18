-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414135646.

-- Enhanced DDI check that splits combination drugs (e.g. "Aceclofenac + Paracetamol")
-- and checks each individual component against the DDI table
CREATE OR REPLACE FUNCTION check_ddi_for_prescription(p_drug_ids uuid[])
RETURNS TABLE (
  drug_a_brand text,
  drug_a_component text,
  drug_b_brand text,
  drug_b_component text,
  severity text,
  description text,
  description_hi text,
  clinical_effect text,
  management text
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH drug_components AS (
    -- Split combination generics into individual components
    SELECT 
      d.id as drug_id,
      d.brand_name,
      d.generic_name,
      trim(unnest(string_to_array(
        -- Normalize: remove parenthetical notes like "(per SKU)" before splitting
        regexp_replace(d.generic_name, '\s*\(.*?\)', '', 'g'),
        '+'
      ))) as component
    FROM drugs d
    WHERE d.id = ANY(p_drug_ids)
  ),
  -- Normalize component names for matching
  normalized AS (
    SELECT 
      drug_id, brand_name, generic_name,
      trim(lower(component)) as component_lower,
      component
    FROM drug_components
    WHERE component != '' 
      AND component NOT LIKE '%per SKU%'
      AND component NOT LIKE '%per %'
  )
  SELECT DISTINCT
    a.brand_name::text,
    a.component::text,
    b.brand_name::text,
    b.component::text,
    di.severity::text,
    di.description::text,
    di.description_hi::text,
    di.clinical_effect::text,
    di.management::text
  FROM normalized a
  CROSS JOIN normalized b
  JOIN drug_interactions di ON (
    (lower(di.drug_a_generic) = a.component_lower AND lower(di.drug_b_generic) = b.component_lower)
    OR
    (lower(di.drug_a_generic) = b.component_lower AND lower(di.drug_b_generic) = a.component_lower)
  )
  WHERE a.drug_id != b.drug_id
  ORDER BY 
    CASE di.severity 
      WHEN 'contraindicated' THEN 1 
      WHEN 'severe' THEN 2 
      WHEN 'moderate' THEN 3 
      WHEN 'mild' THEN 4 
    END;
END;
$$;

-- Quick helper: check DDI by drug names instead of IDs
CREATE OR REPLACE FUNCTION check_ddi_by_names(p_generic_names text[])
RETURNS TABLE (
  drug_a text,
  drug_b text,
  severity text,
  description text,
  description_hi text,
  clinical_effect text,
  management text
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
    di.management::text
  FROM components a
  CROSS JOIN components b
  JOIN drug_interactions di ON (
    (lower(di.drug_a_generic) = a.component AND lower(di.drug_b_generic) = b.component)
    OR
    (lower(di.drug_a_generic) = b.component AND lower(di.drug_b_generic) = a.component)
  )
  WHERE a.component != b.component
  ORDER BY 
    CASE di.severity 
      WHEN 'contraindicated' THEN 1 
      WHEN 'severe' THEN 2 
      WHEN 'moderate' THEN 3 
      WHEN 'mild' THEN 4 
    END;
END;
$$;

-- Function to get compiled bilingual instructions for a prescription
CREATE OR REPLACE FUNCTION get_bilingual_instructions(p_codes text[])
RETURNS TABLE (
  instruction_en text,
  instruction_hi text,
  compiled_en text,
  compiled_hi text
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH instructions AS (
    SELECT pi.instruction_en, pi.instruction_hi, pi.sort_order
    FROM prescription_instructions pi
    WHERE pi.code = ANY(p_codes) AND pi.is_active = true
    ORDER BY pi.sort_order
  )
  SELECT 
    i.instruction_en,
    i.instruction_hi,
    string_agg(i.instruction_en, ' | ' ORDER BY i.sort_order)::text as compiled_en,
    string_agg(i.instruction_hi, ' | ' ORDER BY i.sort_order)::text as compiled_hi
  FROM instructions i
  GROUP BY i.instruction_en, i.instruction_hi, i.sort_order
  ORDER BY i.sort_order;
END;
$$;
