-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408180253.

-- Add drug_id foreign key to hospital_inventory
ALTER TABLE hospital_inventory 
ADD COLUMN drug_id uuid REFERENCES drugs(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX idx_inventory_drug_id ON hospital_inventory(drug_id);

-- Update existing inventory records to link to drugs table
-- Match by generic_name + brand_name
UPDATE hospital_inventory hi
SET drug_id = d.id
FROM drugs d
WHERE hi.drug_id IS NULL
  AND hi.hospital_id = d.hospital_id
  AND LOWER(TRIM(hi.generic_name)) = LOWER(TRIM(d.generic_name))
  AND LOWER(TRIM(COALESCE(hi.brand_name, ''))) = LOWER(TRIM(COALESCE(d.brand_name, '')));

-- For unmatched inventory, create corresponding drug records
INSERT INTO drugs (
  hospital_id, 
  generic_name, 
  brand_name, 
  dosage_form, 
  strength, 
  min_stock_level,
  is_active
)
SELECT DISTINCT
  hi.hospital_id,
  hi.generic_name,
  hi.brand_name,
  hi.dosage_form,
  hi.strength,
  hi.reorder_level,
  true
FROM hospital_inventory hi
WHERE hi.drug_id IS NULL
ON CONFLICT DO NOTHING;

-- Link the newly created drugs
UPDATE hospital_inventory hi
SET drug_id = d.id
FROM drugs d
WHERE hi.drug_id IS NULL
  AND hi.hospital_id = d.hospital_id
  AND LOWER(TRIM(hi.generic_name)) = LOWER(TRIM(d.generic_name))
  AND LOWER(TRIM(COALESCE(hi.brand_name, ''))) = LOWER(TRIM(COALESCE(d.brand_name, '')));
