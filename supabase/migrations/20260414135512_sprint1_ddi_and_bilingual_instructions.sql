-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414135512.

-- ============================================
-- 1. Drug category + dosage_form enrichment on drugs table
-- ============================================

-- Add SNOMED columns to drugs table if not exists
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS snomed_sctid text;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS snomed_term text;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS drug_class text;  -- e.g. NSAID, Antibiotic, Antihypertensive

-- ============================================
-- 2. Drug-Drug Interaction (DDI) table
-- ============================================
CREATE TABLE IF NOT EXISTS drug_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_a_generic text NOT NULL,         -- generic name of drug A
  drug_b_generic text NOT NULL,         -- generic name of drug B
  severity text NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe', 'contraindicated')),
  description text NOT NULL,            -- what happens
  description_hi text,                  -- Hindi description
  clinical_effect text,                 -- e.g. "increased bleeding risk"
  management text,                      -- what to do about it
  source text DEFAULT 'curated',        -- data source
  created_at timestamptz DEFAULT now(),
  UNIQUE(drug_a_generic, drug_b_generic)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ddi_drug_a ON drug_interactions(drug_a_generic);
CREATE INDEX IF NOT EXISTS idx_ddi_drug_b ON drug_interactions(drug_b_generic);

-- Enable RLS
ALTER TABLE drug_interactions ENABLE ROW LEVEL SECURITY;

-- DDI is reference data, readable by all authenticated users
CREATE POLICY "DDI readable by authenticated" ON drug_interactions
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- 3. Bilingual prescription instructions lookup
-- ============================================
CREATE TABLE IF NOT EXISTS prescription_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,            -- e.g. 'after_food', 'before_food', 'empty_stomach'
  category text NOT NULL,               -- 'timing', 'frequency', 'warning', 'storage', 'route'
  instruction_en text NOT NULL,         -- English text
  instruction_hi text NOT NULL,         -- Hindi text
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE prescription_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructions readable by authenticated" ON prescription_instructions
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- 4. Add bilingual instruction fields to prescriptions
-- ============================================
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS instruction_codes text[];  -- array of codes from prescription_instructions
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS instructions_hi text;       -- compiled Hindi instructions

-- Same for opd_prescriptions
ALTER TABLE opd_prescriptions ADD COLUMN IF NOT EXISTS instruction_codes text[];
ALTER TABLE opd_prescriptions ADD COLUMN IF NOT EXISTS instructions_hi text;

-- ============================================
-- 5. DDI check function
-- ============================================
CREATE OR REPLACE FUNCTION check_drug_interactions(p_generic_names text[])
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
  SELECT 
    di.drug_a_generic,
    di.drug_b_generic,
    di.severity,
    di.description,
    di.description_hi,
    di.clinical_effect,
    di.management
  FROM drug_interactions di
  WHERE di.drug_a_generic = ANY(p_generic_names)
    AND di.drug_b_generic = ANY(p_generic_names)
    AND di.drug_a_generic != di.drug_b_generic
  ORDER BY 
    CASE di.severity 
      WHEN 'contraindicated' THEN 1 
      WHEN 'severe' THEN 2 
      WHEN 'moderate' THEN 3 
      WHEN 'mild' THEN 4 
    END;
END;
$$;
