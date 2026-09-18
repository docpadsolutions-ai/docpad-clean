-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416110746.

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Doctor interaction embeddings table
CREATE TABLE IF NOT EXISTS doctor_interaction_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'prescription', 'investigation', 'diagnosis', 'followup',
    'admission_order', 'nurse_instruction', 'procedure', 'referral'
  )),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  content_text TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_die_embedding 
ON doctor_interaction_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for filtering by practitioner before vector search
CREATE INDEX IF NOT EXISTS idx_die_practitioner 
ON doctor_interaction_embeddings (practitioner_id, interaction_type);

-- Index for dedup checks
CREATE INDEX IF NOT EXISTS idx_die_source 
ON doctor_interaction_embeddings (source_table, source_id);

-- RLS
ALTER TABLE doctor_interaction_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctors_own_embeddings" ON doctor_interaction_embeddings
  FOR ALL USING (
    practitioner_id IN (
      SELECT id FROM practitioners WHERE user_id = auth.uid()
    )
  );

-- RPC: get similar past encounters for a doctor
CREATE OR REPLACE FUNCTION get_similar_interactions(
  p_practitioner_id UUID,
  p_embedding vector(768),
  p_interaction_type TEXT DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  interaction_type TEXT,
  source_table TEXT,
  source_id UUID,
  content_text TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    die.id,
    die.interaction_type,
    die.source_table,
    die.source_id,
    die.content_text,
    die.metadata,
    1 - (die.embedding <=> p_embedding) AS similarity,
    die.created_at
  FROM doctor_interaction_embeddings die
  WHERE die.practitioner_id = p_practitioner_id
    AND (p_interaction_type IS NULL OR die.interaction_type = p_interaction_type)
    AND die.embedding IS NOT NULL
  ORDER BY die.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- RPC: get top prescriptions for a diagnosis (pre-embedding fallback)
CREATE OR REPLACE FUNCTION get_doctor_prescription_patterns(
  p_practitioner_id UUID,
  p_diagnosis_text TEXT DEFAULT NULL,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  content_text TEXT,
  metadata JSONB,
  frequency BIGINT,
  last_used TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    content_text,
    metadata,
    COUNT(*) AS frequency,
    MAX(created_at) AS last_used
  FROM doctor_interaction_embeddings
  WHERE practitioner_id = p_practitioner_id
    AND interaction_type = 'prescription'
    AND (p_diagnosis_text IS NULL OR content_text ILIKE '%' || p_diagnosis_text || '%')
  GROUP BY content_text, metadata
  ORDER BY frequency DESC, last_used DESC
  LIMIT p_limit;
$$;

NOTIFY pgrst, 'reload schema';
