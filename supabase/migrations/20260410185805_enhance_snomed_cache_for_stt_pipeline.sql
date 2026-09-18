-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260410185805.

-- 1. Enhance snomed_concept_cache with body_site, specialty, synonyms for better matching
ALTER TABLE snomed_concept_cache 
  ADD COLUMN IF NOT EXISTS fsn TEXT,
  ADD COLUMN IF NOT EXISTS synonyms TEXT[],
  ADD COLUMN IF NOT EXISTS body_sites TEXT[],
  ADD COLUMN IF NOT EXISTS semantic_tag TEXT,
  ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS specialty_tags TEXT[];

-- 2. Enhance snomed_cache with display_term and fsn for disambiguation
ALTER TABLE snomed_cache
  ADD COLUMN IF NOT EXISTS display_term TEXT,
  ADD COLUMN IF NOT EXISTS fsn TEXT,
  ADD COLUMN IF NOT EXISTS body_site_sctid TEXT,
  ADD COLUMN IF NOT EXISTS body_site_term TEXT,
  ADD COLUMN IF NOT EXISTS specialty TEXT;

-- 3. Add composite index for specialty-aware cache lookups
CREATE INDEX IF NOT EXISTS idx_snomed_cache_term_specialty 
  ON snomed_cache(term, specialty);

CREATE INDEX IF NOT EXISTS idx_snomed_concept_cache_specialty 
  ON snomed_concept_cache USING GIN(specialty_tags);

CREATE INDEX IF NOT EXISTS idx_snomed_concept_cache_body_sites 
  ON snomed_concept_cache USING GIN(body_sites);

-- 4. Add full text search index on snomed_concept_cache for fast fuzzy matching
ALTER TABLE snomed_concept_cache 
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_snomed_concept_search 
  ON snomed_concept_cache USING GIN(search_vector);

-- 5. Function to update search vector
CREATE OR REPLACE FUNCTION update_snomed_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.pt_term, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.fsn, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.synonyms, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snomed_concept_search_vector ON snomed_concept_cache;
CREATE TRIGGER trg_snomed_concept_search_vector
  BEFORE INSERT OR UPDATE ON snomed_concept_cache
  FOR EACH ROW EXECUTE FUNCTION update_snomed_search_vector();

-- 6. Enhance doctor_concept_frequency with context
ALTER TABLE doctor_concept_frequency
  ADD COLUMN IF NOT EXISTS context_type TEXT,
  ADD COLUMN IF NOT EXISTS display_term TEXT;

-- 7. Add index for fast doctor-specific lookups
CREATE INDEX IF NOT EXISTS idx_doctor_concept_freq_lookup 
  ON doctor_concept_frequency(doctor_id, use_count DESC);

-- 8. RPC: Fast SNOMED lookup with specialty + body site awareness
CREATE OR REPLACE FUNCTION search_snomed_cached(
  p_query TEXT,
  p_specialty TEXT DEFAULT NULL,
  p_body_site TEXT DEFAULT NULL,
  p_doctor_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(
  sctid TEXT,
  pt_term TEXT,
  fsn TEXT,
  concept_type TEXT,
  icd10_map TEXT,
  body_sites TEXT[],
  relevance_score FLOAT,
  source TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- Tier 1: Doctor's personal frequent concepts
  doctor_freq AS (
    SELECT 
      dcf.sctid::TEXT,
      COALESCE(dcf.display_term, scc.pt_term) as pt_term,
      scc.fsn,
      scc.concept_type,
      scc.icd10_map,
      scc.body_sites,
      (1.0 + (dcf.use_count::float / 100.0)) as relevance_score,
      'doctor_history'::TEXT as source
    FROM doctor_concept_frequency dcf
    LEFT JOIN snomed_concept_cache scc ON scc.sctid = dcf.sctid
    WHERE dcf.doctor_id = p_doctor_id
      AND dcf.display_term ILIKE '%' || p_query || '%'
    ORDER BY dcf.use_count DESC
    LIMIT 5
  ),
  -- Tier 2: Full-text search on concept cache
  cache_search AS (
    SELECT 
      scc.sctid::TEXT,
      scc.pt_term,
      scc.fsn,
      scc.concept_type,
      scc.icd10_map,
      scc.body_sites,
      ts_rank(scc.search_vector, plainto_tsquery('english', p_query))::FLOAT
        + CASE WHEN p_specialty = ANY(scc.specialty_tags) THEN 0.5 ELSE 0.0 END
        + CASE WHEN p_body_site IS NOT NULL AND p_body_site = ANY(scc.body_sites) THEN 0.3 ELSE 0.0 END
        + CASE WHEN scc.is_common THEN 0.2 ELSE 0.0 END
        as relevance_score,
      'cache'::TEXT as source
    FROM snomed_concept_cache scc
    WHERE scc.search_vector @@ plainto_tsquery('english', p_query)
      -- EXCLUDE concepts with wrong body sites when body_site is specified
      AND (
        p_body_site IS NULL 
        OR scc.body_sites IS NULL 
        OR scc.body_sites = '{}'
        OR p_body_site = ANY(scc.body_sites)
        -- Also exclude concepts whose FSN contains anatomy unrelated to the specified body site
        OR NOT (
          (p_body_site ILIKE '%toe%' AND (scc.fsn ILIKE '%conjunctiv%' OR scc.fsn ILIKE '%nasal%' OR scc.fsn ILIKE '%ear%' OR scc.fsn ILIKE '%vagina%' OR scc.fsn ILIKE '%oral%'))
          OR (p_body_site ILIKE '%thigh%' AND (scc.fsn ILIKE '%inguinal%' OR scc.fsn ILIKE '%abdomen%' OR scc.fsn ILIKE '%conjunctiv%'))
          OR (p_body_site ILIKE '%knee%' AND (scc.fsn ILIKE '%elbow%' OR scc.fsn ILIKE '%shoulder%' OR scc.fsn ILIKE '%hip%'))
          OR (p_body_site ILIKE '%shoulder%' AND (scc.fsn ILIKE '%hip%' OR scc.fsn ILIKE '%knee%' OR scc.fsn ILIKE '%ankle%'))
        )
      )
    ORDER BY relevance_score DESC
    LIMIT p_limit
  ),
  -- Tier 3: Simple ILIKE fallback on snomed_cache
  simple_cache AS (
    SELECT 
      sc.concept_id::TEXT as sctid,
      sc.term as pt_term,
      sc.fsn,
      sc.category as concept_type,
      NULL::TEXT as icd10_map,
      CASE WHEN sc.body_site_term IS NOT NULL THEN ARRAY[sc.body_site_term] ELSE NULL END as body_sites,
      0.1::FLOAT as relevance_score,
      'simple_cache'::TEXT as source
    FROM snomed_cache sc
    WHERE sc.term ILIKE '%' || p_query || '%'
      AND (p_specialty IS NULL OR sc.specialty = p_specialty OR sc.specialty IS NULL)
    LIMIT 5
  )
  -- Combine all tiers, deduplicate by sctid, order by relevance
  SELECT DISTINCT ON (combined.sctid)
    combined.sctid,
    combined.pt_term,
    combined.fsn,
    combined.concept_type,
    combined.icd10_map,
    combined.body_sites,
    combined.relevance_score,
    combined.source
  FROM (
    SELECT * FROM doctor_freq
    UNION ALL
    SELECT * FROM cache_search
    UNION ALL
    SELECT * FROM simple_cache
  ) combined
  ORDER BY combined.sctid, combined.relevance_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 9. RPC: Increment doctor concept frequency (called after doctor confirms a code)
CREATE OR REPLACE FUNCTION increment_doctor_concept(
  p_doctor_id UUID,
  p_sctid TEXT,
  p_display_term TEXT DEFAULT NULL,
  p_context_type TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO doctor_concept_frequency (doctor_id, sctid, use_count, last_used, display_term, context_type)
  VALUES (p_doctor_id, p_sctid, 1, NOW(), p_display_term, p_context_type)
  ON CONFLICT (doctor_id, sctid)
  DO UPDATE SET 
    use_count = doctor_concept_frequency.use_count + 1,
    last_used = NOW(),
    display_term = COALESCE(EXCLUDED.display_term, doctor_concept_frequency.display_term),
    context_type = COALESCE(EXCLUDED.context_type, doctor_concept_frequency.context_type);
END;
$$ LANGUAGE plpgsql;

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';
