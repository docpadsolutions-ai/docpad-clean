-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412075133.

-- Extract numeric strength from brand name where strength is null
-- Matches patterns like: 500MG, 10MG, 2.5, 100MCG, 650mg, etc.
UPDATE hospital_inventory
SET strength = (
  regexp_match(brand_name, '(\d+\.?\d*\s*(?:mg|mcg|g|ml|iu|%|mEq))', 'i')
)[1]
WHERE strength IS NULL
  AND brand_name ~ '\d+\.?\d*\s*(?:mg|mcg|g|ml|iu|%|mEq)'
  AND is_active = true;

-- Verify
SELECT brand_name, generic_name, strength, dosage_form_name
FROM hospital_inventory
WHERE strength IS NOT NULL
LIMIT 15;
