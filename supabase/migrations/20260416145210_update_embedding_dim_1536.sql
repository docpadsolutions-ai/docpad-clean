-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416145210.

ALTER TABLE doctor_interaction_embeddings 
  ALTER COLUMN embedding TYPE vector(1536);

DROP INDEX IF EXISTS idx_die_embedding;
CREATE INDEX idx_die_embedding ON doctor_interaction_embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
